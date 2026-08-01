import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readValues,
  writeValues,
  COVER_STATE,
  BUTTON_STATUS,
} from '../src/freebox/deviceMapping.js';

// The Freebox `trigger` endpoint is true for the RESTING state, as its
// `status_text_range` shows: ["Ouvert", "Fermé"] on an opening sensor (index 1
// = true = "Fermé") and ["Mouvement détecté", "Aucun mouvement"] on a motion
// one. Gladys uses the opposite convention: 1 means open / motion detected.
test('readValues inverts the Freebox sensor polarity', () => {
  assert.equal(readValues['opening-sensor'].binary(true), 0, 'true means closed');
  assert.equal(readValues['opening-sensor'].binary(false), 1, 'false means open');
  assert.equal(readValues['motion-sensor'].binary(true), 0, 'true means no motion');
  assert.equal(readValues['motion-sensor'].binary(false), 1, 'false means motion');
});

// The Freebox answers `value: null` on endpoints it has never refreshed. A
// reader returning undefined tells the poll to skip the feature instead of
// publishing a wrong 0.
test('readValues publishes nothing when the Freebox has no value yet', () => {
  assert.equal(readValues['opening-sensor'].binary(null), undefined);
  assert.equal(readValues['motion-sensor'].binary(undefined), undefined);
  assert.equal(readValues.battery.integer(null), undefined);
  assert.equal(readValues.shutter.position(null), undefined);
  assert.equal(readValues.tamper.binary(null), undefined);
});

test('readValues inverts shutter position (Freebox <-> Gladys)', () => {
  assert.equal(readValues.shutter.position(30), 70);
  assert.equal(readValues.shutter.position(0), 100, 'Freebox 0% = fully open in Gladys');
});

// SHUTTER.STATE maps to the `stop` void endpoint: there is no state to read
// back. Publishing a placeholder would push a string into the numeric `state`
// column, which makes the core reject the whole batch.
test('readValues publishes no state for the write-only shutter control', () => {
  assert.equal(readValues.shutter.state(), undefined);
  assert.equal(readValues.button.push(), undefined);
});

test('writeValues inverts shutter position back', () => {
  assert.equal(writeValues.shutter.position(70), 30);
});

// COVER_STATE values travel through the numeric `state` column and are compared
// to the core constant: they must stay numbers, never 'open'/'close' strings.
test('COVER_STATE mirrors the numeric core constant', () => {
  assert.equal(COVER_STATE.STOP, 0);
  assert.equal(COVER_STATE.OPEN, 1);
  assert.equal(COVER_STATE.CLOSE, -1);
  assert.equal(writeValues.shutter.state(COVER_STATE.OPEN), 1);
  assert.equal(writeValues.shutter.state('-1'), -1, 'a string command is coerced back to a number');
});

// The keyfob reports which button was pressed (1 = main alarm, 2 = disarm,
// 3 = secondary alarm); each maps to a distinct Gladys click type so a scene
// can trigger on the exact button.
test('readValues maps the keyfob button to a click type', () => {
  assert.equal(readValues.button.click(1), BUTTON_STATUS.CLICK);
  assert.equal(readValues.button.click(2), BUTTON_STATUS.DOUBLE_CLICK);
  assert.equal(readValues.button.click(3), BUTTON_STATUS.LONG_CLICK_PRESS);
  assert.equal(readValues.button.click(0), undefined, 'no button pressed publishes nothing');
  assert.equal(readValues.button.click(null), undefined);
});

// Alarm command endpoints are `void`: the Freebox refuses a payload.
test('writeValues sends no payload for a push button', () => {
  assert.equal(writeValues.button.push(1), null);
});

// The alarm panel state is a string ("idle"): it travels through `text`.
test('readValues keeps the alarm state as text', () => {
  assert.equal(readValues.text.text('idle'), 'idle');
  assert.equal(readValues.text.text(''), undefined, 'an empty state publishes nothing');
  assert.equal(readValues.text.text(null), undefined);
});
