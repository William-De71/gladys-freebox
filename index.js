// -----------------------------------------------------------------------------
// Entry point of the Freebox external integration.
//
// Role of this file: wire the Gladys SDK to the Freebox client and the device
// orchestration (src/devices.js). It:
//   1. instantiates the SDK (connection, auth, reconnection handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. exposes the manifest actions (pair / test / reboot / unpair);
//   4. publishes the discovered devices once connected and paired.
//
// Pairing model: the Freebox app token is obtained through the "Pair with the
// Freebox" manifest action (the user confirms on the box LCD screen), then
// persisted through gladys.setConfig() under a key NOT declared in the
// config_schema (APP_TOKEN_CONFIG_KEY). It is reloaded on every connection.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { FreeboxClient } from './src/freebox/FreeboxClient.js';
import { APP_TOKEN_CONFIG_KEY } from './src/freebox/constants.js';
import {
  buildDiscoveredDevices,
  pollDevice,
  setDeviceValue,
  getDeviceImage,
  startCameraPush,
} from './src/devices.js';
import { forLog } from './src/externalId.js';

const gladys = new GladysIntegration();
const client = new FreeboxClient();

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
 * Publish the discovered devices, if the Freebox is paired.
 * @returns {Promise<void>} Resolves when published (no-op if not paired).
 */
async function publishDevicesIfPaired() {
  const appToken = await getAppToken();
  if (!appToken) {
    logger.info('Freebox not paired yet: use the "Pair with the Freebox" action.');
    await gladys
      .setConnectionStatus(false, {
        en: 'Freebox not paired. Click "Pair with the Freebox".',
        fr: 'Freebox non appairée. Cliquez sur « Appairer avec la Freebox ».',
      })
      .catch(() => {});
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
  await setDeviceValue(gladys, client, appToken, device, feature, value);
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
      return {
        en: 'The Freebox is already paired. Use "Unpair" first to pair again.',
        fr: 'La Freebox est déjà appairée. Utilisez « Désappairer » pour réappairer.',
      };
    }

    const { appToken, trackId } = await client.requestAuthorization();
    logger.info('Please confirm the authorization on the Freebox LCD screen (right arrow).');
    await client.waitForAuthorization(trackId);

    // Persist the app token (key outside the config_schema).
    await gladys.setConfig({ [APP_TOKEN_CONFIG_KEY]: appToken });

    // Publish the devices right away.
    await publishDevicesIfPaired();

    return {
      en: 'Freebox paired successfully! You can now create your devices.',
      fr: 'Freebox appairée avec succès ! Vous pouvez maintenant créer vos appareils.',
    };
  } catch (e) {
    logger.error('Freebox pairing failed', e);
    await gladys.setConnectionStatus(false).catch(() => {});
    return {
      en: `Pairing failed: ${e.message}`,
      fr: `Échec de l'appairage : ${e.message}`,
    };
  }
});

// --- Manifest action: test the connection ------------------------------------
gladys.onAction('test_connection', async () => {
  try {
    const appToken = await getAppToken();
    if (!appToken) {
      return {
        en: 'Freebox not paired. Click "Pair with the Freebox" first.',
        fr: "Freebox non appairée. Cliquez d'abord sur « Appairer avec la Freebox ».",
      };
    }
    await client.openSession(appToken);
    const devices = await buildDiscoveredDevices(gladys, client, appToken);
    return {
      en: `Connection OK: ${devices.length} device(s) available on the Freebox.`,
      fr: `Connexion OK : ${devices.length} appareil(s) disponible(s) sur la Freebox.`,
    };
  } catch (e) {
    return {
      en: `Connection failed: ${e.message}`,
      fr: `Échec de la connexion : ${e.message}`,
    };
  }
});

// --- Manifest action: reboot the Freebox -------------------------------------
gladys.onAction('reboot', async () => {
  logger.info('Action reboot -> rebooting the Freebox');
  try {
    const appToken = await getAppToken();
    if (!appToken) {
      return {
        en: 'Freebox not paired. Click "Pair with the Freebox" first.',
        fr: "Freebox non appairée. Cliquez d'abord sur « Appairer avec la Freebox ».",
      };
    }
    await client.reboot(appToken);
    return {
      en: 'Reboot requested. Your Freebox will restart in a few seconds.',
      fr: 'Redémarrage demandé. Votre Freebox va redémarrer dans quelques secondes.',
    };
  } catch (e) {
    logger.error('Freebox reboot failed', e);
    return {
      en: `Reboot failed: ${e.message}`,
      fr: `Échec du redémarrage : ${e.message}`,
    };
  }
});

// --- Manifest action: unpair -------------------------------------------------
gladys.onAction('unpair', async () => {
  logger.info('Action unpair -> removing the stored app token');
  await gladys.setConfig({ [APP_TOKEN_CONFIG_KEY]: '' });
  client.reset();
  await gladys.setConnectionStatus(false).catch(() => {});
  return {
    en: 'Freebox unpaired. The stored token has been removed.',
    fr: 'Freebox désappairée. Le token stocké a été supprimé.',
  };
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
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  stopCameraPushIfRunning();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopCameraPushIfRunning();
  client.reset();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Freebox integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
