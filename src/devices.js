// -----------------------------------------------------------------------------
// Device orchestration: discovery, polling, commands and camera images.
//
// This module bridges the FreeboxClient (raw API) and the Gladys SDK. It holds
// no connection state of its own: the FreeboxClient instance and the app token
// getter are injected by index.js.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { convertDevice, convertPlayer, getPlayerBaseUrl } from './freebox/convert.js';
import { readValues, writeValues, COVER_STATE } from './freebox/deviceMapping.js';
import { captureCameraImage } from './freebox/camera.js';
import { PLAYER } from './freebox/constants.js';
import { toPublishedDevice, toNativeId } from './externalId.js';

const logger = createLogger({ name: 'freebox-devices' });

// Gladys television feature types -> Freebox player media commands.
const MEDIA_COMMANDS = {
  [DEVICE_FEATURE_TYPES.TELEVISION.PLAY]: 'play',
  [DEVICE_FEATURE_TYPES.TELEVISION.PAUSE]: 'pause',
  [DEVICE_FEATURE_TYPES.TELEVISION.STOP]: 'stop',
  [DEVICE_FEATURE_TYPES.TELEVISION.PREVIOUS]: 'prev',
  [DEVICE_FEATURE_TYPES.TELEVISION.NEXT]: 'next',
  [DEVICE_FEATURE_TYPES.TELEVISION.REWIND]: 'seek_backward',
  [DEVICE_FEATURE_TYPES.TELEVISION.FORWARD]: 'seek_forward',
};

/**
 * Build the full list of Gladys devices discovered on the Freebox
 * (home-automation devices + players). Published as-is with
 * publishDiscoveredDevices(): the user picks which ones to create in Gladys.
 * External ids are prefixed with `ext:<selector>:` as the core requires.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {import('./freebox/FreeboxClient.js').FreeboxClient} client - Freebox client.
 * @param {string} appToken - The stored app token.
 * @returns {Promise<object[]>} Gladys devices.
 * @example
 * const devices = await buildDiscoveredDevices(gladys, client, appToken);
 */
export async function buildDiscoveredDevices(gladys, client, appToken) {
  const devices = [];

  let homeDevices = [];
  try {
    homeDevices = await client.loadDevices(appToken);
  } catch (e) {
    logger.error('Unable to load Freebox home devices', e);
  }
  homeDevices.forEach((device) => {
    try {
      devices.push(convertDevice(device));
    } catch (e) {
      logger.error('Error converting Freebox device', e);
    }
  });

  let players = [];
  try {
    players = await client.loadPlayers(appToken);
  } catch (e) {
    logger.warn('Unable to load Freebox players (check the "player" permission in Freebox OS)');
    logger.debug(e);
  }
  players.forEach((player) => {
    try {
      devices.push(convertPlayer(player));
    } catch (e) {
      logger.error(
        `Error converting Freebox player "${player && player.device_name}": ${e.message}`,
      );
      logger.debug(e);
    }
  });

  logger.info(`Freebox discovery: ${devices.length} device(s) built`);

  const published = devices.map((device) => toPublishedDevice(gladys, device));

  // A duplicated selector makes the core reject the device creation with a
  // generic error, so surface it here rather than at creation time.
  const selectors = new Map();
  published.forEach((device) => {
    [
      { selector: device.selector, label: device.name },
      ...(device.features || []).map((f) => ({
        selector: f.selector,
        label: `${device.name}/${f.name}`,
      })),
    ].forEach(({ selector, label }) => {
      if (!selector) {
        return;
      }
      if (selectors.has(selector)) {
        logger.warn(
          `Freebox: duplicated selector "${selector}" (${selectors.get(selector)} and ${label}) — ` +
            `the core will refuse to create one of them.`,
        );
      }
      selectors.set(selector, label);
    });
  });

  logger.debug(`Freebox published payload: ${JSON.stringify(published)}`);

  return published;
}

/**
 * Poll a Gladys device: read its current values and publish the states.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {import('./freebox/FreeboxClient.js').FreeboxClient} client - Freebox client.
 * @param {string} appToken - The stored app token.
 * @param {object} device - The Gladys device to poll.
 * @returns {Promise<void>} Resolves when polled.
 * @example
 * await pollDevice(gladys, client, appToken, device);
 */
export async function pollDevice(gladys, client, appToken, device) {
  // The device external_id is prefixed with `ext:<selector>:`; parse the native
  // Freebox id ("freebox:{nodeId}...") to extract the node.
  const [prefix, nodeId] = toNativeId(gladys, device.external_id).split(':');
  if (prefix !== 'freebox') {
    throw new Error(`Freebox device external_id is invalid: "${device.external_id}"`);
  }

  if (nodeId === PLAYER.EXTERNAL_ID_SEGMENT) {
    await pollPlayer(gladys, client, appToken, device);
    return;
  }

  // Cameras are NOT captured here: an ffmpeg snapshot takes ~5s and the poll
  // ack deadline is only 5s. Camera images are pushed by a dedicated loop
  // (startCameraPush) and served fresh on demand through onGetImage (15s ack).
  const hasCamera = (device.features || []).some(
    (f) => f.category === DEVICE_FEATURE_CATEGORIES.CAMERA,
  );
  if (hasCamera) {
    return;
  }

  const data = await client.loadNodeValues(appToken, nodeId);
  const valuesByEndpoint = {};
  data.forEach((endpoint) => {
    valuesByEndpoint[endpoint.ep_id] = endpoint.value;
  });

  const states = [];
  (device.features || []).forEach((feature) => {
    // Camera image values are URLs, handled through the image channel above.
    if (feature.category === DEVICE_FEATURE_CATEGORIES.CAMERA) {
      return;
    }
    const [, , epId] = toNativeId(gladys, feature.external_id).split(':');
    const rawValue = valuesByEndpoint[epId];

    const reader = readValues[feature.category] && readValues[feature.category][feature.type];
    if (!reader) {
      return;
    }
    const transformed = reader(rawValue);
    if (transformed !== null && transformed !== undefined) {
      states.push({ device_feature_external_id: feature.external_id, state: transformed });
    }
  });

  if (states.length > 0) {
    await gladys.publishStates(states);
  }
}

/**
 * Poll a Freebox Player device (power, volume, mute).
 * @param {object} gladys - The Gladys SDK instance.
 * @param {import('./freebox/FreeboxClient.js').FreeboxClient} client - Freebox client.
 * @param {string} appToken - The stored app token.
 * @param {object} device - The player device.
 * @returns {Promise<void>} Resolves when polled.
 * @example
 * await pollPlayer(gladys, client, appToken, device);
 */
async function pollPlayer(gladys, client, appToken, device) {
  const playerBaseUrl = getPlayerBaseUrl({
    ...device,
    external_id: toNativeId(gladys, device.external_id),
  });
  const states = [];

  const pushState = (featureType, value) => {
    const feature = (device.features || []).find((f) => f.type === featureType);
    if (feature && value !== null && value !== undefined) {
      states.push({ device_feature_external_id: feature.external_id, state: value });
    }
  };

  const statusResponse = await client.playerRequest(appToken, { path: `${playerBaseUrl}/status/` });
  const powerState =
    statusResponse.data && statusResponse.data.result && statusResponse.data.result.power_state;
  pushState(DEVICE_FEATURE_TYPES.TELEVISION.BINARY, powerState === 'running' ? 1 : 0);

  // Volume is only reachable when the player is running.
  if (powerState === 'running') {
    try {
      const volumeResponse = await client.playerRequest(appToken, {
        path: `${playerBaseUrl}/control/volume`,
      });
      const result = (volumeResponse.data && volumeResponse.data.result) || {};
      if (result.volume !== undefined) {
        pushState(DEVICE_FEATURE_TYPES.TELEVISION.VOLUME, result.volume);
      }
      if (result.mute !== undefined) {
        pushState(DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_MUTE, result.mute ? 1 : 0);
      }
    } catch (e) {
      logger.debug(`Freebox: unable to get volume of player "${device.external_id}"`);
      logger.debug(e);
    }
  }

  if (states.length > 0) {
    await gladys.publishStates(states);
  }
}

/**
 * Apply a user command on a Gladys device feature.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {import('./freebox/FreeboxClient.js').FreeboxClient} client - Freebox client.
 * @param {string} appToken - The stored app token.
 * @param {object} device - The Gladys device.
 * @param {object} feature - The Gladys device feature.
 * @param {number} value - The new value.
 * @returns {Promise<void>} Resolves when applied.
 * @example
 * await setDeviceValue(gladys, client, appToken, device, feature, 1);
 */
export async function setDeviceValue(gladys, client, appToken, device, feature, value) {
  // external_ids are prefixed with `ext:<selector>:`; parse the native ids.
  const [prefix, nodeId, endpointId] = toNativeId(gladys, feature.external_id).split(':');
  if (prefix !== 'freebox') {
    throw new Error(`Freebox feature external_id is invalid: "${feature.external_id}"`);
  }

  if (nodeId === PLAYER.EXTERNAL_ID_SEGMENT) {
    await setPlayerValue(gladys, client, appToken, device, feature, value);
    return;
  }

  const writer = writeValues[feature.category] && writeValues[feature.category][feature.type];
  const transformedValue = writer ? writer(value) : value;

  let endpointIdToDevice = endpointId;
  let valueToDevice = transformedValue;

  // The Freebox shutter/store models map the Gladys STATE/POSITION features to
  // different endpoints and values, depending on the physical device model.
  switch (device.model) {
    case 'alarm_control':
      endpointIdToDevice = endpointId;
      valueToDevice = null;
      break;
    case 'store':
      if (endpointId === '1') {
        valueToDevice = null;
        if (transformedValue === COVER_STATE.CLOSE) {
          endpointIdToDevice = 2;
        } else if (transformedValue === COVER_STATE.OPEN) {
          endpointIdToDevice = 0;
        } else if (transformedValue === COVER_STATE.STOP) {
          endpointIdToDevice = endpointId;
        }
      }
      break;
    case 'store_slider':
      endpointIdToDevice = endpointId;
      valueToDevice = transformedValue;
      if (endpointId === '1') {
        if (transformedValue === COVER_STATE.CLOSE) {
          endpointIdToDevice = 3;
          valueToDevice = 100;
        } else if (transformedValue === COVER_STATE.OPEN) {
          endpointIdToDevice = 3;
          valueToDevice = 0;
        } else if (transformedValue === COVER_STATE.STOP) {
          endpointIdToDevice = endpointId;
          valueToDevice = null;
        }
      }
      break;
    default:
      endpointIdToDevice = endpointId;
      valueToDevice = transformedValue;
  }

  logger.debug(`Freebox set ${nodeId}/${endpointIdToDevice} = ${valueToDevice}`);
  await client.setEndpointValue(appToken, nodeId, endpointIdToDevice, valueToDevice);
}

/**
 * Apply a command on a Freebox Player (volume, mute, media control).
 * @param {object} gladys - The Gladys SDK instance.
 * @param {import('./freebox/FreeboxClient.js').FreeboxClient} client - Freebox client.
 * @param {string} appToken - The stored app token.
 * @param {object} device - The player device.
 * @param {object} feature - The player feature.
 * @param {number} value - The new value.
 * @returns {Promise<void>} Resolves when applied.
 * @see https://github.com/Aymkdn/assistant-freebox-cloud/wiki/Player-API
 */
async function setPlayerValue(gladys, client, appToken, device, feature, value) {
  const playerBaseUrl = getPlayerBaseUrl({
    ...device,
    external_id: toNativeId(gladys, device.external_id),
  });
  logger.debug(`Freebox player: set "${feature.type}" = ${value}`);

  if (feature.type === DEVICE_FEATURE_TYPES.TELEVISION.VOLUME) {
    await client.playerRequest(appToken, {
      method: 'PUT',
      path: `${playerBaseUrl}/control/volume`,
      data: { volume: Math.round(Number(value)) },
    });
    return;
  }

  if (feature.type === DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_MUTE) {
    await client.playerRequest(appToken, {
      method: 'PUT',
      path: `${playerBaseUrl}/control/volume`,
      data: { mute: Number(value) === 1 },
    });
    return;
  }

  const cmd = MEDIA_COMMANDS[feature.type];
  if (!cmd) {
    throw new Error(`Freebox player: feature type "${feature.type}" is not managed`);
  }
  await client.playerRequest(appToken, {
    method: 'POST',
    path: `${playerBaseUrl}/control/mediactrl`,
    data: { cmd },
  });
}

/**
 * Capture a fresh camera image (onGetImage handler).
 * @param {object} device - The Gladys camera device.
 * @returns {Promise<string>} `image/jpg;base64,...` string.
 * @example
 * const image = await getDeviceImage(device);
 */
export async function getDeviceImage(device) {
  return captureCameraImage(device);
}

// Push a camera snapshot at most this often (ms). Stay well under the core
// limit of 12 images/minute per device.
const CAMERA_PUSH_INTERVAL_MS = 60000;

/**
 * Start the periodic camera-image push loop. Every interval, it lists the
 * cameras the user created (gladys.getDevices) and pushes a fresh snapshot for
 * each — a channel independent of the 5s poll ack, so a slow ffmpeg capture
 * fits. Returns a cleanup function to stop the loop (on disconnection).
 * @param {object} gladys - The Gladys SDK instance.
 * @returns {function(): void} Cleanup function.
 * @example
 * const stop = startCameraPush(gladys);
 */
export function startCameraPush(gladys) {
  let running = false;

  const tick = async () => {
    // Skip if a previous tick is still capturing (slow network / many cameras).
    if (running) {
      return;
    }
    running = true;
    try {
      const devices = await gladys.getDevices();
      const cameras = (devices || []).filter((device) =>
        (device.features || []).some((f) => f.category === DEVICE_FEATURE_CATEGORIES.CAMERA),
      );
      // Capture sequentially: one ffmpeg at a time keeps the container light.
      for (const camera of cameras) {
        try {
          const image = await captureCameraImage(camera);
          await gladys.publishCameraImage(camera.external_id, image);
          logger.info(
            `Freebox: camera image pushed for "${camera.external_id}" (${image.length} bytes)`,
          );
        } catch (e) {
          logger.warn(`Freebox: camera push failed for "${camera.external_id}": ${e.message}`);
          logger.debug(e);
        }
      }
    } catch (e) {
      logger.warn(`Freebox: camera push loop error: ${e.message}`);
      logger.debug(e);
    } finally {
      running = false;
    }
  };

  // Run once shortly after start, then on the interval.
  const startTimer = setTimeout(tick, 3000);
  const interval = setInterval(tick, CAMERA_PUSH_INTERVAL_MS);

  return () => {
    clearTimeout(startTimer);
    clearInterval(interval);
  };
}
