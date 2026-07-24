import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toExternalId, toNativeId, toPublishedDevice, toNativeDevice } from '../src/externalId.js';

const gladys = { selector: 'ext-dev-freebox' };

test('toExternalId prefixes a native Freebox id', () => {
  assert.equal(toExternalId(gladys, 'freebox:12:1'), 'ext:ext-dev-freebox:freebox:12:1');
});

test('toNativeId strips the core prefix (round-trip)', () => {
  const native = 'freebox:12:1';
  assert.equal(toNativeId(gladys, toExternalId(gladys, native)), native);
});

test('toNativeId leaves an unprefixed id untouched', () => {
  assert.equal(toNativeId(gladys, 'freebox:12:1'), 'freebox:12:1');
});

test('toPublishedDevice prefixes the device and every feature', () => {
  const device = {
    name: 'Volet',
    external_id: 'freebox:12',
    features: [{ external_id: 'freebox:12:1' }, { external_id: 'freebox:12:2' }],
  };
  const published = toPublishedDevice(gladys, device);
  assert.equal(published.external_id, 'ext:ext-dev-freebox:freebox:12');
  assert.deepEqual(
    published.features.map((f) => f.external_id),
    ['ext:ext-dev-freebox:freebox:12:1', 'ext:ext-dev-freebox:freebox:12:2'],
  );
});

test('toNativeDevice reverses toPublishedDevice', () => {
  const device = {
    name: 'Volet',
    external_id: 'freebox:12',
    features: [{ external_id: 'freebox:12:1' }],
  };
  const roundTrip = toNativeDevice(gladys, toPublishedDevice(gladys, device));
  assert.equal(roundTrip.external_id, 'freebox:12');
  assert.equal(roundTrip.features[0].external_id, 'freebox:12:1');
});
