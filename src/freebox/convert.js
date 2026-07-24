// -----------------------------------------------------------------------------
// Conversion of Freebox devices/players into the Gladys discovery format.
//
// External ids keep the native Freebox scheme, stable across runs:
//   - home device : "freebox:{nodeId}"
//   - home feature: "freebox:{nodeId}:{endpointId}"
//   - player      : "freebox:player:{id}"
//   - player feat.: "freebox:player:{id}:{televisionType}"
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { mappings, MOTION, OPENING } from './deviceMapping.js';
import { PLAYER } from './constants.js';

const logger = createLogger({ name: 'freebox-convert' });

// Poll frequencies, in milliseconds (the core validates poll_frequency against
// a fixed list: 60000, 30000, 15000, 10000, 2000, 1000).
const POLL_EVERY_30_SECONDS = 30000;
const POLL_EVERY_MINUTE = 60000;

/**
 * Transform a single Freebox function into a Gladys feature.
 * @param {object} freeboxFunction - Freebox function (endpoint).
 * @param {string} externalId - Device external id ("freebox:{nodeId}").
 * @returns {object|undefined} Gladys feature, or undefined if unmanaged.
 * @example
 * convertFeature({ ep_id: 1, name: 'trigger', label: 'Détection' }, 'freebox:12');
 */
export function convertFeature(freeboxFunction, externalId) {
  const { ep_id: epId, label, name } = freeboxFunction;

  let readOnly = false;
  if (freeboxFunction.ui && freeboxFunction.ui.access === 'r') {
    readOnly = true;
  }

  // The generic "trigger" function covers both motion and opening sensors;
  // disambiguate on the French label the Freebox exposes.
  let mappingKey = name;
  if (name === 'trigger') {
    if (label === 'Détection') {
      mappingKey = MOTION;
    } else if (label === 'État') {
      mappingKey = OPENING;
    }
  }

  const categoryAndType = mappings[mappingKey];
  if (!categoryAndType) {
    logger.debug(`Freebox function "${mappingKey}" is not managed`);
    return undefined;
  }

  const feature = {
    name,
    external_id: `${externalId}:${epId}`,
    read_only: readOnly,
    keep_history: true,
    has_feedback: false,
    min: 0,
    max: 1,
    ...categoryAndType,
  };

  if (mappingKey === 'position' || mappingKey === 'battery_warning') {
    feature.max = 100;
  }

  if (mappingKey === 'cam') {
    feature.max = 0;
    feature.read_only = true;
    feature.keep_history = false;
  }

  return feature;
}

/**
 * Transform a Freebox home device (grouped tiles) into a Gladys device.
 * @param {object} freeboxDevice - Freebox device ({ node_id, specifications }).
 * @returns {object} Gladys device.
 * @example
 * convertDevice({ node_id: 12, specifications: [...] });
 */
export function convertDevice(freeboxDevice) {
  const { action, label: name, node_id: id, type, data } = freeboxDevice.specifications[0];
  const externalId = `freebox:${id}`;

  logger.debug(`Freebox convert device "${name}"`);

  const model = action === undefined ? type : action;

  // Group functions by name: status and command share the same feature.
  const groups = {};
  (data || []).forEach((func) => {
    groups[func.name] = func;
  });

  const features = Object.values(groups)
    .map((group) => convertFeature(group, externalId))
    .filter(Boolean);

  const device = {
    name,
    external_id: externalId,
    features,
    model,
    poll_frequency: POLL_EVERY_30_SECONDS,
    should_poll: true,
  };

  // Camera: store the stream URL as a device param, used to capture snapshots.
  // The Freebox exposes an HLS URL (the RTSP one misses the H264 SPS/PPS
  // parameters and ffmpeg cannot decode it, while HLS works fine).
  if (type === 'camera') {
    const camFunc = (data || []).find((func) => func.name === 'cam');
    if (camFunc && camFunc.value) {
      device.params = [
        { name: 'CAMERA_URL', value: camFunc.value },
        { name: 'CAMERA_ROTATION', value: '0' },
      ];
      device.poll_frequency = POLL_EVERY_MINUTE;
      logger.info(`Freebox camera "${name}" detected with stream URL: ${camFunc.value}`);
    }
  }

  return device;
}

// Features exposed for a Freebox Player, all under the "television" category.
// "power" is read-only: the player API only reports the power state.
const PLAYER_FEATURES = [
  {
    name: 'Power',
    type: DEVICE_FEATURE_TYPES.TELEVISION.BINARY,
    read_only: true,
    keep_history: true,
    min: 0,
    max: 1,
  },
  {
    name: 'Volume',
    type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 100,
  },
  {
    name: 'Mute',
    type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_MUTE,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Play',
    type: DEVICE_FEATURE_TYPES.TELEVISION.PLAY,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Pause',
    type: DEVICE_FEATURE_TYPES.TELEVISION.PAUSE,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Stop',
    type: DEVICE_FEATURE_TYPES.TELEVISION.STOP,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Previous',
    type: DEVICE_FEATURE_TYPES.TELEVISION.PREVIOUS,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Next',
    type: DEVICE_FEATURE_TYPES.TELEVISION.NEXT,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Rewind',
    type: DEVICE_FEATURE_TYPES.TELEVISION.REWIND,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Fast forward',
    type: DEVICE_FEATURE_TYPES.TELEVISION.FORWARD,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
];

/**
 * Transform a Freebox Player into a Gladys device.
 * @param {object} freeboxPlayer - Freebox player ({ id, device_name, api_version }).
 * @returns {object} Gladys device.
 * @example
 * convertPlayer({ id: 1, device_name: 'Freebox Player', api_version: '7.0' });
 */
export function convertPlayer(freeboxPlayer) {
  const { id, device_name: name, api_version: apiVersion } = freeboxPlayer;
  const externalId = `freebox:${PLAYER.EXTERNAL_ID_SEGMENT}:${id}`;

  logger.debug(`Freebox convert player "${name}"`);

  // Player API is versioned independently ("7.0" -> "v7" in the URL).
  const [apiVersionMajor] = `${apiVersion}`.split('.');

  const features = PLAYER_FEATURES.map((feature) => ({
    name: feature.name,
    external_id: `${externalId}:${feature.type}`,
    category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
    type: feature.type,
    unit: feature.unit,
    read_only: feature.read_only,
    keep_history: feature.keep_history,
    has_feedback: false,
    min: feature.min,
    max: feature.max,
  }));

  return {
    name,
    external_id: externalId,
    features,
    model: PLAYER.MODEL,
    poll_frequency: POLL_EVERY_30_SECONDS,
    should_poll: true,
    params: [{ name: PLAYER.API_VERSION_PARAM, value: `v${apiVersionMajor}` }],
  };
}

/**
 * Build the player API base URL from a Gladys player device.
 * @param {object} device - Gladys device (external_id "freebox:player:{id}").
 * @returns {string} Base URL, e.g. "/player/1/api/v6".
 * @example
 * getPlayerBaseUrl(device);
 */
export function getPlayerBaseUrl(device) {
  const [, , playerId] = device.external_id.split(':');
  const apiVersionParam = (device.params || []).find(
    (param) => param.name === PLAYER.API_VERSION_PARAM,
  );
  const apiVersion = apiVersionParam ? apiVersionParam.value : PLAYER.DEFAULT_API_VERSION;
  return `/player/${playerId}/api/${apiVersion}`;
}
