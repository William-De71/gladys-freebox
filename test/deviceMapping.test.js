import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readValues, writeValues, COVER_STATE } from '../src/freebox/deviceMapping.js';

test('readValues converts boolean sensor states to 0/1', () => {
  assert.equal(readValues['opening-sensor'].binary(true), 1);
  assert.equal(readValues['opening-sensor'].binary(false), 0);
  assert.equal(readValues['motion-sensor'].binary(true), 1);
});

test('readValues inverts shutter position (Freebox <-> Gladys)', () => {
  assert.equal(readValues.shutter.position(30), 70);
  assert.equal(readValues.shutter.state(), COVER_STATE.STOP);
});

test('writeValues inverts shutter position back', () => {
  assert.equal(writeValues.shutter.position(70), 30);
  assert.equal(writeValues.shutter.state('open'), 'open');
});
