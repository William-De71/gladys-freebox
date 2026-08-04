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
import {
  mappings,
  MOTION,
  OPENING,
  POSITION,
  BATTERY,
  CONTROL,
  CAMERA,
  PUSHED,
  ALARM1,
  ALARM2,
  ALARM_OFF,
  ALARM_SKIP,
} from './deviceMapping.js';
import { PLAYER } from './constants.js';

const logger = createLogger({ name: 'freebox-convert' });

// Write-only `void` endpoints of the alarm control panel.
const ALARM_COMMANDS = [ALARM1, ALARM2, ALARM_OFF, ALARM_SKIP];

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

  // `access` is 'r' (sensor), 'w' (command button) or 'rw' (both). Endpoints
  // with no `ui` block are internal Freebox signals, never user-facing.
  const access = (freeboxFunction.ui && freeboxFunction.ui.access) || 'r';
  const readOnly = access === 'r';

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

  // The core builds the feature selector with slugify(name) and that column is
  // UNIQUE across the whole table. Freebox function names ("position", "cam",
  // "battery_warning") are generic enough to collide with another integration,
  // so publish an explicit selector built from the node and endpoint ids.
  const nodeId = externalId.split(':')[1];

  // The name is what the dashboard shows next to the device ("Volet bureau
  // (Position du volet)"). The Freebox label is the human wording the user
  // already sees in Freebox OS, so prefer it over the technical function name.
  const displayName = label || name;

  const feature = {
    name: displayName,
    external_id: `${externalId}:${epId}`,
    selector: `freebox-${nodeId}-${epId}-${name}`,
    read_only: readOnly,
    keep_history: true,
    has_feedback: false,
    min: 0,
    max: 1,
    ...categoryAndType,
  };

  if (mappingKey === POSITION || mappingKey === BATTERY) {
    feature.max = 100;
  }

  // Shutter STATE and the alarm commands are `void` write-only endpoints: the
  // Freebox exposes no value to read back, so history would only ever record
  // the command we just sent.
  if (mappingKey === CONTROL || ALARM_COMMANDS.includes(mappingKey)) {
    feature.keep_history = false;
  }

  // Gladys renders a SHUTTER.STATE feature as the open/pause/close buttons; it
  // spans -1 (close) to 1 (open).
  if (mappingKey === CONTROL) {
    feature.min = -1;
  }

  // The keyfob reports which button was pressed (1..3); a click is an event, so
  // the dashboard shows the last press rather than a persistent state.
  if (mappingKey === PUSHED) {
    feature.max = 6;
  }

  if (mappingKey === CAMERA) {
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
  const { action, label, node_id: id, type, data } = freeboxDevice.specifications[0];
  const externalId = `freebox:${id}`;

  // `name` is NOT NULL in Gladys: an unlabelled tile would be rejected when the
  // user creates the device. Fall back on a stable label built from the node id.
  const name = label || `Freebox ${id}`;

  logger.debug(`Freebox convert device "${name}"`);

  const model = action === undefined ? type : action;

  // Every endpoint is a candidate feature, keyed by ep_id: two endpoints of the
  // same node can share a function name (the sensors expose an internal
  // `alarm1`/`alarm2` signal alongside the panel's `alarm1`/`alarm2` buttons),
  // and grouping by name would silently drop one of them.
  //
  // Endpoints without a `ui` block are internal Freebox signals, not meant to
  // be shown: that is exactly how the box distinguishes the sensors' internal
  // `alarm1` (ui: null) from the alarm panel's `alarm1` button.
  const features = (data || [])
    .filter((func) => func.ui)
    .map((func) => convertFeature(func, externalId))
    .filter(Boolean);

  // Same UNIQUE selector constraint as the features: a device named like an
  // existing one (an homonym in another integration) would be rejected.
  const device = {
    name,
    external_id: externalId,
    selector: `freebox-${id}`,
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
      // The stream URL embeds the camera credentials: log the host only, so a
      // log pasted in a bug report does not leak them.
      let streamHost = '?';
      try {
        streamHost = new URL(camFunc.value).host;
      } catch {
        // Not a parseable URL: keep the placeholder rather than print it raw.
      }
      logger.info(`Freebox camera "${name}" detected, stream on ${streamHost}`);
      logger.debug(`Freebox camera "${name}" stream URL: ${camFunc.value}`);
    }
  }

  return device;
}

// Features exposed for a Freebox Player, all under the "television" category.
// "power" is writable through the remote control key, which is a TOGGLE: the
// command is only sent when the current power state differs from the requested
// one (see setPlayerValue), so the feature behaves as a regular on/off switch.
//
// Three distinct Freebox endpoints sit behind these features (see
// setPlayerValue): `/control/mediactrl` drives the MEDIA being played,
// `/control/open` tunes a channel by number, and `/control/remote` presses a
// key of the physical remote. Only the first two are officially documented.
//
// "Next"/"Previous" are media commands, NOT channel changes: zapping is either
// "Channel" (by number, documented) or "Channel up"/"Channel down" (relative,
// undocumented remote keys).
const PLAYER_FEATURES = [
  {
    name: 'Power',
    type: DEVICE_FEATURE_TYPES.TELEVISION.BINARY,
    read_only: false,
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
  // Tuning a channel by number: the only zapping the official API documents
  // (`open` with a `tv:?channel=N` URL). Freebox channel numbers go past 900,
  // so the range is wide on purpose.
  {
    name: 'Channel',
    type: DEVICE_FEATURE_TYPES.TELEVISION.CHANNEL,
    read_only: false,
    keep_history: false,
    min: 1,
    max: 999,
  },
  {
    name: 'Channel up',
    type: DEVICE_FEATURE_TYPES.TELEVISION.CHANNEL_UP,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Channel down',
    type: DEVICE_FEATURE_TYPES.TELEVISION.CHANNEL_DOWN,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'TV',
    type: DEVICE_FEATURE_TYPES.TELEVISION.SOURCE,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Home',
    type: DEVICE_FEATURE_TYPES.TELEVISION.MENU,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Guide',
    type: DEVICE_FEATURE_TYPES.TELEVISION.GUIDE,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Info',
    type: DEVICE_FEATURE_TYPES.TELEVISION.INFO,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Up',
    type: DEVICE_FEATURE_TYPES.TELEVISION.UP,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Down',
    type: DEVICE_FEATURE_TYPES.TELEVISION.DOWN,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Left',
    type: DEVICE_FEATURE_TYPES.TELEVISION.LEFT,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Right',
    type: DEVICE_FEATURE_TYPES.TELEVISION.RIGHT,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'OK',
    type: DEVICE_FEATURE_TYPES.TELEVISION.ENTER,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Back',
    type: DEVICE_FEATURE_TYPES.TELEVISION.RETURN,
    read_only: false,
    keep_history: false,
    min: 0,
    max: 1,
  },
  {
    name: 'Record',
    type: DEVICE_FEATURE_TYPES.TELEVISION.RECORD,
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
  const { id, device_name: deviceName, api_version: apiVersion } = freeboxPlayer;

  // The player id builds every external_id AND every feature selector: without
  // it we would publish "freebox:player:undefined" and collide with any other
  // unidentified player. Player id 0 is valid, so only null/undefined/'' fail.
  if (id === undefined || id === null || `${id}` === '') {
    throw new Error(
      `Freebox player without id, cannot be published: ${JSON.stringify(freeboxPlayer)}`,
    );
  }

  const externalId = `freebox:${PLAYER.EXTERNAL_ID_SEGMENT}:${id}`;

  // `name` is NOT NULL in Gladys: a player whose device_name is missing or
  // empty would be rejected when the user creates it. Fall back on a stable
  // label built from the player id.
  const name = deviceName || `${PLAYER.DEFAULT_NAME} ${id}`;

  // Player API is versioned independently ("7.0" -> "v7" in the URL). Keep the
  // documented default when the box does not advertise a version, so the param
  // never ends up as "vundefined".
  const apiVersionParam = apiVersion
    ? `v${`${apiVersion}`.split('.')[0]}`
    : PLAYER.DEFAULT_API_VERSION;

  // The Gladys core generates a feature selector with slugify(name) and that
  // column is UNIQUE across the WHOLE table, not per device. Plain names like
  // "Volume" or "Play" would collide with any feature of any other integration
  // (and between two Freebox Players), making the device creation fail with a
  // generic error. Publishing an explicit selector derived from the player id
  // keeps the display name readable while guaranteeing uniqueness.
  const features = PLAYER_FEATURES.map((feature) => ({
    name: feature.name,
    external_id: `${externalId}:${feature.type}`,
    selector: `freebox-${PLAYER.EXTERNAL_ID_SEGMENT}-${id}-${feature.type}`,
    category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
    type: feature.type,
    unit: feature.unit,
    read_only: feature.read_only,
    keep_history: feature.keep_history,
    has_feedback: false,
    min: feature.min,
    max: feature.max,
  }));

  logger.debug(
    `Freebox player "${name}" (id=${id}, api=${apiVersionParam}) converted with ` +
      `${features.length} feature(s): ${features.map((f) => f.selector).join(', ')}`,
  );

  return {
    name,
    external_id: externalId,
    selector: `freebox-${PLAYER.EXTERNAL_ID_SEGMENT}-${id}`,
    features,
    model: PLAYER.MODEL,
    poll_frequency: POLL_EVERY_30_SECONDS,
    should_poll: true,
    params: [{ name: PLAYER.API_VERSION_PARAM, value: apiVersionParam }],
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
