// -----------------------------------------------------------------------------
// Mapping between Freebox home-automation functions and Gladys features.
//
// - `mappings`   : Freebox function name -> Gladys { category, type, unit }
// - `readValues` : how to transform a value read from the Freebox into a Gladys
//                  state, keyed by category then type
// - `writeValues`: how to transform a Gladys value into a Freebox value,
//                  keyed by category then type
//
// A reader returning `undefined` means "nothing to publish": the poll skips the
// feature instead of pushing a wrong value. This matters because the Freebox
// answers `value: null` on endpoints it has never refreshed (a battery level
// before the first sensor report, for instance).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Gladys cover/shutter states. These MUST stay numbers: they travel through
// `publishStates({ state })`, a numeric column, and the core compares them to
// its own COVER_STATE constant. Publishing the strings 'open'/'close'/'stop'
// makes the core reject the WHOLE batch, which silently kills every other
// state of the same device.
export const COVER_STATE = {
  STOP: 0,
  OPEN: 1,
  CLOSE: -1,
};

// Gladys button states (mirror of the core BUTTON_STATUS constant).
export const BUTTON_STATUS = {
  CLICK: 1,
  DOUBLE_CLICK: 2,
  LONG_CLICK_PRESS: 3,
};

// Freebox function names we handle.
export const OPENING = 'opening';
export const MOTION = 'motion';
export const BATTERY = 'battery_warning';
export const CONTROL = 'stop';
export const POSITION = 'position';
export const CAMERA = 'cam';
export const PUSHED = 'pushed';
export const COVER = 'cover';
export const ALARM_STATE = 'state';
export const ALARM1 = 'alarm1';
export const ALARM2 = 'alarm2';
export const ALARM_OFF = 'off';
export const ALARM_SKIP = 'skip';

// The Freebox alarm keyfob reports which button was last pressed, as an int:
// 0 = none, 1 = main alarm, 2 = disarm, 3 = secondary alarm (`status_text_range`
// of the `pushed` endpoint). Gladys has no "which button" feature, so map each
// press to a distinct click type: scenes can then trigger on the exact button.
const PUSHED_TO_BUTTON_STATUS = {
  1: BUTTON_STATUS.CLICK,
  2: BUTTON_STATUS.DOUBLE_CLICK,
  3: BUTTON_STATUS.LONG_CLICK_PRESS,
};

export const mappings = {
  [OPENING]: {
    category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  },
  [MOTION]: {
    category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  },
  [BATTERY]: {
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
  },
  [CONTROL]: {
    category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
    type: DEVICE_FEATURE_TYPES.SHUTTER.STATE,
  },
  [POSITION]: {
    category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
    type: DEVICE_FEATURE_TYPES.SHUTTER.POSITION,
  },
  [CAMERA]: {
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
  },
  // Alarm keyfob: read-only report of the last button pressed.
  [PUSHED]: {
    category: DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: DEVICE_FEATURE_TYPES.BUTTON.CLICK,
  },
  // Sensor casing opened: the anti-tamper contact of the device.
  [COVER]: {
    category: DEVICE_FEATURE_CATEGORIES.TAMPER,
    type: DEVICE_FEATURE_TYPES.TAMPER.BINARY,
  },
  // Alarm control panel: textual state ("idle", "alarm1_arming"...).
  [ALARM_STATE]: {
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  },
  // Alarm control panel: the four write-only command buttons. BUTTON.PUSH is
  // the only Gladys type the dashboard renders as a one-shot action button
  // (see PushDeviceFeature); SWITCH.BINARY would draw a toggle, which does not
  // match a `void` endpoint that has no state to come back to.
  [ALARM1]: {
    category: DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
  },
  [ALARM2]: {
    category: DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
  },
  [ALARM_OFF]: {
    category: DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
  },
  [ALARM_SKIP]: {
    category: DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
  },
};

export const writeValues = {
  [DEVICE_FEATURE_CATEGORIES.SHUTTER]: {
    [DEVICE_FEATURE_TYPES.SHUTTER.STATE]: (valueFromGladys) => Number(valueFromGladys),
    // Gladys: 0 = closed, 100 = open. Freebox "Consigne d'ouverture": the same
    // scale reversed, so both directions invert the percentage.
    [DEVICE_FEATURE_TYPES.SHUTTER.POSITION]: (valueFromGladys) =>
      100 - parseInt(valueFromGladys, 10),
  },
  // Alarm buttons are `void` endpoints: the Freebox expects no payload, the
  // write itself triggers the action.
  [DEVICE_FEATURE_CATEGORIES.BUTTON]: {
    [DEVICE_FEATURE_TYPES.BUTTON.PUSH]: () => null,
  },
};

export const readValues = {
  [DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR]: {
    // The Freebox `trigger` of an opening sensor is true when CLOSED
    // (`status_text_range: ["Ouvert", "Fermé"]`), while Gladys expects
    // 1 = open. Publish nothing when the box has no value yet.
    [DEVICE_FEATURE_TYPES.SENSOR.BINARY]: (valueFromDevice) => {
      if (typeof valueFromDevice !== 'boolean') {
        return undefined;
      }
      return valueFromDevice ? 0 : 1;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR]: {
    // Same inversion: `status_text_range: ["Mouvement détecté", "Aucun
    // mouvement"]`, so true means "no motion" and Gladys expects 1 = motion.
    [DEVICE_FEATURE_TYPES.SENSOR.BINARY]: (valueFromDevice) => {
      if (typeof valueFromDevice !== 'boolean') {
        return undefined;
      }
      return valueFromDevice ? 0 : 1;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.BATTERY]: {
    // `Number(null)` is 0, so null must be rejected explicitly: the Freebox
    // reports a null battery until the sensor has sent its first level, and
    // publishing 0 % would raise a false "empty battery" alert.
    [DEVICE_FEATURE_TYPES.BATTERY.INTEGER]: (valueFromDevice) => {
      if (valueFromDevice === null || valueFromDevice === undefined || valueFromDevice === '') {
        return undefined;
      }
      const value = Number(valueFromDevice);
      return Number.isFinite(value) ? value : undefined;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.TAMPER]: {
    [DEVICE_FEATURE_TYPES.TAMPER.BINARY]: (valueFromDevice) => {
      if (typeof valueFromDevice !== 'boolean') {
        return undefined;
      }
      return valueFromDevice ? 1 : 0;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.BUTTON]: {
    [DEVICE_FEATURE_TYPES.BUTTON.CLICK]: (valueFromDevice) =>
      PUSHED_TO_BUTTON_STATUS[Number(valueFromDevice)],
    // Command buttons are write-only `void` endpoints: nothing to read back.
    [DEVICE_FEATURE_TYPES.BUTTON.PUSH]: () => undefined,
  },
  [DEVICE_FEATURE_CATEGORIES.SHUTTER]: {
    // Write-only: the Freebox `stop` endpoint is a `void` button with no state
    // to read, and publishing a placeholder would overwrite the real position
    // shown on the dashboard.
    [DEVICE_FEATURE_TYPES.SHUTTER.STATE]: () => undefined,
    [DEVICE_FEATURE_TYPES.SHUTTER.POSITION]: (valueFromDevice) => {
      const value = parseInt(valueFromDevice, 10);
      return Number.isFinite(value) ? 100 - value : undefined;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.CAMERA]: {
    [DEVICE_FEATURE_TYPES.CAMERA.IMAGE]: (valueFromDevice) => valueFromDevice,
  },
  // Alarm state is a string: published through `text`, never `state`.
  [DEVICE_FEATURE_CATEGORIES.TEXT]: {
    [DEVICE_FEATURE_TYPES.TEXT.TEXT]: (valueFromDevice) =>
      typeof valueFromDevice === 'string' && valueFromDevice !== '' ? valueFromDevice : undefined,
  },
};
