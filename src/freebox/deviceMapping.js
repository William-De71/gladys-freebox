// -----------------------------------------------------------------------------
// Mapping between Freebox home-automation functions and Gladys features.
//
// - `mappings`   : Freebox function name -> Gladys { category, type, unit }
// - `readValues` : how to transform a value read from the Freebox into a Gladys
//                  state, keyed by category then type
// - `writeValues`: how to transform a Gladys value into a Freebox value,
//                  keyed by category then type
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Gladys cover/shutter states (mirror of the Gladys core COVER_STATE constant).
export const COVER_STATE = {
  OPEN: 'open',
  CLOSE: 'close',
  STOP: 'stop',
};

// Freebox function names we handle.
export const OPENING = 'opening';
export const MOTION = 'motion';
export const BATTERY = 'battery_warning';
export const CONTROL = 'stop';
export const POSITION = 'position';
export const CAMERA = 'cam';

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
};

export const writeValues = {
  [DEVICE_FEATURE_CATEGORIES.SHUTTER]: {
    [DEVICE_FEATURE_TYPES.SHUTTER.STATE]: (valueFromGladys) => valueFromGladys,
    [DEVICE_FEATURE_TYPES.SHUTTER.POSITION]: (valueFromGladys) =>
      100 - parseInt(valueFromGladys, 10),
  },
};

export const readValues = {
  [DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.BINARY]: (valueFromDevice) => (valueFromDevice === true ? 1 : 0),
  },
  [DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.BINARY]: (valueFromDevice) => (valueFromDevice === true ? 1 : 0),
  },
  [DEVICE_FEATURE_CATEGORIES.BATTERY]: {
    [DEVICE_FEATURE_TYPES.BATTERY.INTEGER]: (valueFromDevice) => valueFromDevice,
  },
  [DEVICE_FEATURE_CATEGORIES.SHUTTER]: {
    [DEVICE_FEATURE_TYPES.SHUTTER.STATE]: () => COVER_STATE.STOP,
    [DEVICE_FEATURE_TYPES.SHUTTER.POSITION]: (valueFromDevice) =>
      100 - parseInt(valueFromDevice, 10),
  },
  [DEVICE_FEATURE_CATEGORIES.CAMERA]: {
    [DEVICE_FEATURE_TYPES.CAMERA.IMAGE]: (valueFromDevice) => valueFromDevice,
  },
};
