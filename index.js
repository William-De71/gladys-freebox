// -----------------------------------------------------------------------------
// Entry point of the Freebox external integration.
//
// Role of this file: wire the Gladys SDK to the Freebox client and the device
// orchestration (src/devices.js). It:
//   1. instantiates the SDK (connection, auth, reconnection handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. exposes the manifest actions (pair / test / reboot / unpair);
//   4. publishes the discovered devices once connected and paired;
//   5. serves the dashboard widgets (box, calls, network), fires the scene
//      triggers (phone call, network device presence, home automation lost or
//      back) from the watch loop (src/watcher.js) and runs the Wake-on-LAN and
//      reboot scene actions.
//
// Pairing model: the Freebox app token is obtained through the "Pair with the
// Freebox" manifest action (the user confirms on the box LCD screen), then
// persisted through gladys.setConfig() under a key NOT declared in the
// config_schema (APP_TOKEN_CONFIG_KEY). It is reloaded on every connection.
// -----------------------------------------------------------------------------

import {
  GladysIntegration,
  logger,
  DEVICE_FEATURE_CATEGORIES,
} from '@gladysassistant/integration-sdk';
import { FreeboxClient } from './src/freebox/FreeboxClient.js';
import {
  APP_TOKEN_CONFIG_KEY,
  LAST_SCENE_REBOOT_CONFIG_KEY,
  SERVER,
} from './src/freebox/constants.js';
import { readSystem, readNetHistory } from './src/freebox/read.js';
import {
  buildDiscoveredDevices,
  pollDevice,
  refreshCreatedDevice,
  setDeviceValue,
  getDeviceImage,
  startCameraPush,
} from './src/devices.js';
import { forLog, toExternalId } from './src/externalId.js';
import { MESSAGES } from './src/messages.js';
import { createWatcher } from './src/watcher.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  PERIODS,
  messageContent,
  readBoxSettings,
  readCallsSettings,
  readNetworkSettings,
  readHistoryOffset,
  readListPage,
  buildBoxWidget,
  buildCallsWidget,
  buildNetworkWidget,
} from './src/widgets.js';
import { createViewStore } from './src/widgetViews.js';
import {
  SCENE_ACTIONS,
  callEvent,
  presenceEvent,
  homeEvent,
  rebootAllowed,
  wakeOnLanMac,
} from './src/events.js';
import { createHomeHealth } from './src/homeHealth.js';
import { t, all } from './src/i18n.js';

const gladys = new GladysIntegration();
const client = new FreeboxClient();

// How far back the box chart looks, which page the network list shows.
const views = createViewStore();

// Whether the home automation of the box still reaches the shutters.
const health = createHomeHealth();

// Cleanup function of the periodic camera-image push loop.
let stopCameraPush = null;

/**
 * Read the app token stored in the Gladys config.
 * @returns {Promise<string|null>} The app token, or null if not paired.
 */
async function getAppToken() {
  const config = await gladys.getConfig();
  return (config && config[APP_TOKEN_CONFIG_KEY]) || null;
}

/**
 * Fire a scene trigger, logging a refusal instead of failing the round.
 * @param {{ key: string, data: object }} event - The event.
 * @returns {Promise<void>} Resolves once sent (or refused).
 */
async function fire({ key, data }) {
  try {
    await gladys.publishSceneEvent(key, data);
  } catch (e) {
    logger.warn(`Freebox: scene event "${key}" refused: ${e.message}`);
  }
}

// The LAN hosts and the call log, read twice a minute: scene triggers on what
// changed, a widget refresh when what a widget shows moved.
const watcher = createWatcher({
  client,
  getAppToken,
  logger,
  onRound: async ({ presence, calls, hostsChanged, callsChanged, home }) => {
    for (const call of calls) {
      logger.info(`Freebox: new ${call.type} call in the log`);
      await fire(callEvent(call));
    }
    for (const change of presence) {
      logger.debug(`Freebox: "${change.host.name}" ${change.event}`);
      await fire(presenceEvent(change));
    }
    const change = health.update(home);
    if (change) {
      if (change.event === 'unreachable') {
        logger.warn(
          `Freebox home automation in trouble (${change.cause})` +
            `${change.names.length > 0 ? `: ${change.names.join(', ')}` : ''}`,
        );
      } else {
        logger.info(`Freebox home automation back after ${change.minutes} min`);
      }
      await fire(homeEvent(change));
    }
    if (hostsChanged) {
      gladys.requestWidgetRefresh(WIDGETS.NETWORK);
    }
    if (callsChanged) {
      gladys.requestWidgetRefresh(WIDGETS.CALLS);
    }
  },
});

/**
 * Publish the Wi-Fi state on the Freebox Server device right after a switch
 * from a widget, when that device exists in Gladys.
 * @param {boolean} enabled - The state the box applied.
 * @returns {Promise<void>} Resolves once published (or skipped).
 */
async function publishWifiState(enabled) {
  const externalId = toExternalId(
    gladys,
    `freebox:${SERVER.EXTERNAL_ID_SEGMENT}:${SERVER.WIFI_KEY}`,
  );
  const exists = (gladys.devices || []).some((device) =>
    (device.features || []).some((feature) => feature.external_id === externalId),
  );
  if (!exists) {
    return;
  }
  await gladys
    .publishChangedStates([{ device_feature_external_id: externalId, state: enabled ? 1 : 0 }])
    .catch((e) => logger.debug(`Freebox: unable to publish the Wi-Fi state: ${e.message}`));
}

/**
 * Publish the discovered devices, if the Freebox is paired.
 * @returns {Promise<void>} Resolves when published (no-op if not paired).
 */
async function publishDevicesIfPaired() {
  const appToken = await getAppToken();
  if (!appToken) {
    logger.info('Freebox not paired yet: use the "Pair with the Freebox" action.');
    await gladys.setConnectionStatus(false, MESSAGES.notPaired).catch(() => {});
    return;
  }
  const devices = await buildDiscoveredDevices(gladys, client, appToken);
  try {
    const result = await gladys.publishDiscoveredDevices(devices);
    logger.info(
      `Freebox: ${devices.length} device(s) published (core count: ${result && result.count})`,
    );
  } catch (e) {
    // GladysApiError carries the real reason (status / code / message); the UI
    // only shows a generic error, so log the details here.
    logger.error(
      `Freebox: publishing the devices failed [${e.status || '?'} ${e.code || '?'}]: ${e.message}`,
    );
    throw e;
  }
  await gladys.setConnectionStatus(true).catch(() => {});
}

// --- Discovery: the user asks for the list of devices ------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered Freebox devices');
  await publishDevicesIfPaired();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${forLog(gladys, feature.external_id)} = ${value}`);
  const appToken = await getAppToken();
  if (!appToken) {
    throw new Error('Freebox is not paired');
  }
  // The outcome of a shutter command tells whether the box still reaches it.
  const isShutter = feature.category === DEVICE_FEATURE_CATEGORIES.SHUTTER;
  // The core sends the device without its name: the SDK cache has it.
  const known = (gladys.devices || []).find((d) => d.external_id === device.external_id);
  const name = device.name || (known && known.name) || forLog(gladys, device.external_id);
  try {
    await setDeviceValue(gladys, client, appToken, device, feature, value);
  } catch (e) {
    if (isShutter) {
      health.commandResult(false, name);
    }
    throw e;
  }
  if (isShutter) {
    health.commandResult(true, name);
  }
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  // Fires for every device on every poll frequency: too noisy for info.
  logger.debug(
    `onPoll <- ${forLog(gladys, device.external_id)} ("${device.name}", model=${device.model}, ` +
      `${(device.features || []).length} feature(s))`,
  );
  const appToken = await getAppToken();
  if (!appToken) {
    logger.warn('onPoll ignored: Freebox not paired');
    return;
  }
  try {
    await pollDevice(gladys, client, appToken, device);
  } catch (e) {
    logger.error(`onPoll failed for ${forLog(gladys, device.external_id)}: ${e.message}`);
    logger.debug(e);
  }
});

// --- Device lifecycle: trace what the user actually creates ------------------
// The Gladys UI only shows a generic "an error occurred" when a creation fails.
// These handlers confirm in the logs which devices went through.
gladys.onDeviceCreated(async (device) => {
  logger.info(
    `Device created in Gladys: "${device.name}" (${forLog(gladys, device.external_id)}, ` +
      `selector=${device.selector}, ${(device.features || []).length} feature(s))`,
  );
  // The states read before this moment were dropped by Gladys: without this,
  // a new device stayed blank until one of its values changed.
  const appToken = await getAppToken();
  if (!appToken) {
    return;
  }
  await refreshCreatedDevice(gladys, client, appToken, device).catch((e) =>
    logger.warn(`First refresh of "${device.name}" failed: ${e.message}`),
  );
});

gladys.onDeviceUpdated(async (device) => {
  logger.info(`Device updated in Gladys: "${device.name}" (${forLog(gladys, device.external_id)})`);
});

// --- Camera: Gladys needs a FRESH image of a camera device -------------------
gladys.onGetImage(async (device) => {
  // Fires on every dashboard live view: too frequent for info.
  logger.debug(`onGetImage <- ${forLog(gladys, device.external_id)}`);
  return getDeviceImage(device);
});

// --- Manifest action: pair with the Freebox ----------------------------------
gladys.onAction('pair', async () => {
  logger.info('Action pair -> requesting Freebox authorization');
  try {
    const existing = await getAppToken();
    if (existing) {
      return MESSAGES.alreadyPaired;
    }

    const { appToken, trackId } = await client.requestAuthorization();
    logger.info('Please confirm the authorization on the Freebox LCD screen (right arrow).');
    await client.waitForAuthorization(trackId);

    // Persist the app token (key outside the config_schema).
    await gladys.setConfig({ [APP_TOKEN_CONFIG_KEY]: appToken });
  } catch (e) {
    logger.error('Freebox pairing failed', e);
    await gladys.setConnectionStatus(false).catch(() => {});
    return MESSAGES.pairingFailed(e.message);
  }

  // The pairing itself is done and saved at this point: a failure to list the
  // devices (permissions not granted yet, a slow box) must not be reported as
  // a failed pairing, which would send the user back to the LCD screen for
  // nothing. A scan from the Discover tab retries the publication.
  try {
    await publishDevicesIfPaired();
  } catch (e) {
    logger.warn(`Freebox paired, but publishing the devices failed: ${e.message}`);
    return MESSAGES.pairedNoDevices;
  }
  return MESSAGES.paired;
});

// --- Manifest action: test the connection ------------------------------------
gladys.onAction('test_connection', async () => {
  try {
    const appToken = await getAppToken();
    if (!appToken) {
      return MESSAGES.notPairedYet;
    }
    await client.openSession(appToken);
    const devices = await buildDiscoveredDevices(gladys, client, appToken);
    return MESSAGES.connectionOk(devices.length);
  } catch (e) {
    return MESSAGES.connectionFailed(e.message);
  }
});

// --- Manifest action: reboot the Freebox -------------------------------------
gladys.onAction('reboot', async () => {
  logger.info('Action reboot -> rebooting the Freebox');
  try {
    const appToken = await getAppToken();
    if (!appToken) {
      return MESSAGES.notPairedYet;
    }
    await client.reboot(appToken);
    return MESSAGES.rebootRequested;
  } catch (e) {
    logger.error('Freebox reboot failed', e);
    return MESSAGES.rebootFailed(e.message);
  }
});

// --- Manifest action: unpair -------------------------------------------------
gladys.onAction('unpair', async () => {
  logger.info('Action unpair -> removing the stored app token');
  await gladys.setConfig({ [APP_TOKEN_CONFIG_KEY]: '' });
  client.reset();
  watcher.reset();
  health.reset();
  await gladys.setConnectionStatus(false).catch(() => {});
  return MESSAGES.unpaired;
});

// --- Dashboard widget: the box at a glance -----------------------------------
gladys.onWidgetGet(WIDGETS.BOX, async ({ settings, language }) => {
  const appToken = await getAppToken();
  if (!appToken) {
    return messageContent(t('notPaired', language));
  }
  let connection;
  try {
    connection = await client.loadConnectionStatus(appToken);
  } catch (e) {
    return messageContent(t('boxUnreachable', language, { reason: e.message }), 30);
  }
  // Everything else is optional: the card shows what the box answered.
  const optional = (promise, what) =>
    promise.catch((e) => {
      logger.debug(`Freebox box widget: ${what} unreadable: ${e.message}`);
      return null;
    });
  const boxSettings = readBoxSettings(settings);
  const { period } = boxSettings;
  const offset = views.get(WIDGETS.BOX, boxSettings, 0);
  // Looking back, the chart is the window `offset` periods before now; live,
  // it ends now (no date_end: the box answers up to its last point).
  const end = Math.floor(Date.now() / 1000) - offset * PERIODS[period];
  const [system, wifi, history] = await Promise.all([
    optional(client.loadSystem(appToken), 'system state'),
    optional(client.loadWifiConfig(appToken), 'Wi-Fi state'),
    optional(
      client.loadNetHistory(appToken, end - PERIODS[period], offset > 0 ? end : undefined),
      'rate history',
    ),
  ]);
  const { hosts } = watcher.snapshot();
  return buildBoxWidget({
    connection,
    system: system && readSystem(system),
    wifi,
    devices: hosts ? hosts.filter((host) => host.active).length : null,
    history: history && readNetHistory(history),
    language,
    period,
    offset,
  });
});

gladys.onWidgetAction(WIDGETS.BOX, async (actionKey, params, { settings }) => {
  if (actionKey === WIDGET_ACTIONS.HISTORY_EARLIER || actionKey === WIDGET_ACTIONS.HISTORY_LATER) {
    // No toast: the core refetches the card right after, the chart moved.
    const boxSettings = readBoxSettings(settings);
    const offset = readHistoryOffset(params, boxSettings.period);
    if (offset === null) {
      throw new Error(`Invalid offset of the box widget action "${actionKey}"`);
    }
    views.set(WIDGETS.BOX, boxSettings, offset);
    return undefined;
  }
  const appToken = await getAppToken();
  if (!appToken) {
    return all('notPaired');
  }
  try {
    if (actionKey === WIDGET_ACTIONS.REBOOT) {
      logger.info('Widget -> rebooting the Freebox');
      await client.reboot(appToken);
      return MESSAGES.rebootRequested;
    }
    if (actionKey === WIDGET_ACTIONS.WIFI_ON || actionKey === WIDGET_ACTIONS.WIFI_OFF) {
      const wanted = actionKey === WIDGET_ACTIONS.WIFI_ON;
      logger.info(`Widget -> Wi-Fi ${wanted ? 'on' : 'off'}`);
      const applied = await client.setWifiEnabled(appToken, wanted);
      const enabled = typeof applied.enabled === 'boolean' ? applied.enabled : wanted;
      await publishWifiState(enabled);
      return all(enabled ? 'wifiSwitchedOn' : 'wifiSwitchedOff');
    }
  } catch (e) {
    logger.warn(`Freebox widget action "${actionKey}" failed: ${e.message}`);
    if (e.code === 'insufficient_rights') {
      return all('settingsPermission');
    }
    return all('actionFailed', { reason: e.message });
  }
  throw new Error(`Unknown action "${actionKey}" of the box widget`);
});

// --- Dashboard widget: the call log ------------------------------------------
gladys.onWidgetGet(WIDGETS.CALLS, async ({ settings, language }) => {
  if (!(await getAppToken())) {
    return messageContent(t('notPaired', language));
  }
  const { calls, callsError } = watcher.snapshot();
  return buildCallsWidget({
    calls,
    error: callsError,
    language,
    show: readCallsSettings(settings).show,
  });
});

gladys.onWidgetAction(WIDGETS.CALLS, async (actionKey) => {
  if (actionKey !== WIDGET_ACTIONS.MARK_CALLS_READ) {
    throw new Error(`Unknown action "${actionKey}" of the calls widget`);
  }
  const appToken = await getAppToken();
  if (!appToken) {
    return all('notPaired');
  }
  try {
    await client.markCallsAsRead(appToken);
  } catch (e) {
    return all('actionFailed', { reason: e.message });
  }
  // The core refetches the content right after this answer: read the log
  // again first, or the card would still show the calls as unread.
  await watcher.runNow();
  return all('callsMarkedRead');
});

// --- Dashboard widget: the devices of the network ----------------------------
gladys.onWidgetGet(WIDGETS.NETWORK, async ({ settings, language }) => {
  if (!(await getAppToken())) {
    return messageContent(t('notPaired', language));
  }
  const networkSettings = readNetworkSettings(settings);
  return buildNetworkWidget({
    hosts: watcher.snapshot().hosts,
    language,
    show: networkSettings.show,
    page: views.get(WIDGETS.NETWORK, networkSettings, 1),
  });
});

gladys.onWidgetAction(WIDGETS.NETWORK, async (actionKey, params, { settings }) => {
  if (actionKey !== WIDGET_ACTIONS.PAGE_PREVIOUS && actionKey !== WIDGET_ACTIONS.PAGE_NEXT) {
    throw new Error(`Unknown action "${actionKey}" of the network widget`);
  }
  const page = readListPage(params);
  if (page === null) {
    throw new Error(`Invalid page of the network widget action "${actionKey}"`);
  }
  // No toast: the core refetches the card right after, on the new page.
  views.set(WIDGETS.NETWORK, readNetworkSettings(settings), page);
  return undefined;
});

// --- Scene action: wake a computer of the network ----------------------------
gladys.onSceneAction(SCENE_ACTIONS.WAKE_ON_LAN, async (fields) => {
  const mac = wakeOnLanMac(fields);
  const appToken = await getAppToken();
  if (!appToken) {
    throw new Error('Freebox is not paired');
  }
  const host = (watcher.snapshot().hosts || []).find((entry) => entry.mac === mac);
  logger.info(`Scene -> Wake-on-LAN ${mac}`);
  await client.wakeOnLan(appToken, mac, host ? host.interface : undefined);
});

// --- Scene action: reboot the box --------------------------------------------
// Meant for a scene reacting to the home automation lost: the reboot is what
// brings the shutters back. The time of the last reboot is kept in the config,
// so a restart of the integration does not lift the minimum interval.
gladys.onSceneAction(SCENE_ACTIONS.REBOOT, async (fields) => {
  const appToken = await getAppToken();
  if (!appToken) {
    throw new Error('Freebox is not paired');
  }
  const config = (await gladys.getConfig()) || {};
  const last = Number(config[LAST_SCENE_REBOOT_CONFIG_KEY]);
  const verdict = rebootAllowed(fields, last > 0 ? last : null, Date.now());
  if (!verdict.allowed) {
    throw new Error(
      `Freebox not rebooted: the scene already rebooted it ${verdict.minutesAgo} min ago ` +
        `(minimum interval ${verdict.interval} min)`,
    );
  }
  logger.info('Scene -> rebooting the Freebox');
  try {
    await client.reboot(appToken);
  } catch (e) {
    if (e.code === 'insufficient_rights') {
      throw new Error(
        'Freebox refused the reboot: tick the "Freebox settings modification" ' +
          'permission of Gladys Assistant in Freebox OS',
        { cause: e },
      );
    }
    throw e;
  }
  await gladys
    .setConfig({ [LAST_SCENE_REBOOT_CONFIG_KEY]: String(Date.now()) })
    .catch((e) => logger.warn(`Freebox: unable to remember the reboot time: ${e.message}`));
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async () => {
  logger.info('onConfigUpdated -> re-checking pairing');
  await publishDevicesIfPaired().catch((e) =>
    logger.error('Re-publish after config update failed', e),
  );
});

/** Stop the camera push loop if it is running. */
function stopCameraPushIfRunning() {
  if (stopCameraPush) {
    stopCameraPush();
    stopCameraPush = null;
  }
}

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await publishDevicesIfPaired();
    // (Re)start the periodic camera-image push loop.
    stopCameraPushIfRunning();
    stopCameraPush = startCameraPush(gladys);
    watcher.start();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
  }
});

gladys.on('disconnected', () => {
  stopCameraPushIfRunning();
  watcher.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopCameraPushIfRunning();
  watcher.stop();
  client.reset();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Freebox integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
