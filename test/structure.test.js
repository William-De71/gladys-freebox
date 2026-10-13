// -----------------------------------------------------------------------------
// Non-regression of everything users store: the device and feature external
// ids and selectors (scenes and dashboards point at them), the fields the
// Discovery "Update" button compares (category, type, unit, min, max, step,
// read_only, has_feedback), the polling settings and device params read back
// by the commands and the camera capture, and every configuration and action
// key.
//
// test/fixtures/discovery.baseline.json was generated from version 1.2.0,
// before any change, with the nodes of test/helpers/samples.js. A failure here
// means existing users would have to delete and recreate a device, or would
// lose a scene: never update the baseline without a documented migration.
// Devices and features may be ADDED; none may change or disappear.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDiscoveredDevices } from '../src/devices.js';
import { sampleClient } from './helpers/samples.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const baseline = read('./fixtures/discovery.baseline.json');
const manifest = read('../gladys-assistant-integration.json');

const PINNED = [
  'external_id',
  'selector',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
];

/**
 * The fields of a feature the baseline pins.
 * @param {object} feature - A published feature.
 * @returns {object} Its pinned fields.
 */
function pick(feature) {
  return Object.fromEntries(
    PINNED.filter((key) => feature[key] !== undefined).map((key) => [key, feature[key]]),
  );
}

const published = await buildDiscoveredDevices(
  { selector: baseline.selector },
  sampleClient(),
  'token',
);
const byExternalId = new Map(published.map((device) => [device.external_id, device]));

for (const [name, expected] of Object.entries(baseline.devices)) {
  test(`the ${name} keeps its ids, its polling, its params and every feature of ${baseline.generated_from}`, () => {
    const device = byExternalId.get(expected.external_id);
    assert.ok(device, `device ${expected.external_id} disappeared`);
    assert.equal(device.selector, expected.selector);
    assert.equal(device.model, expected.model);
    assert.equal(device.should_poll, expected.should_poll);
    assert.equal(device.poll_frequency, expected.poll_frequency);

    const params = (device.params ?? []).map((param) => param.name);
    for (const param of expected.params) {
      assert.ok(params.includes(param), `param ${param}`);
    }

    const features = new Map(device.features.map((feature) => [feature.external_id, feature]));
    for (const stored of expected.features) {
      const now = features.get(stored.external_id);
      assert.ok(now, `feature ${stored.external_id} disappeared`);
      assert.deepEqual(pick(now), stored, stored.external_id);
    }
  });
}

test('every feature carries min, max, read_only and has_feedback', () => {
  for (const device of published) {
    for (const feature of device.features) {
      for (const field of ['min', 'max', 'read_only', 'has_feedback']) {
        assert.notEqual(feature[field], undefined, `${feature.external_id}.${field}`);
      }
    }
  }
});

test('no configuration key disappears or changes type', () => {
  const current = new Map(manifest.config_schema.map((field) => [field.key, field]));
  for (const { key, type } of baseline.manifest.config_schema) {
    assert.equal(current.get(key)?.type, type, `config_schema.${key}`);
  }
});

test('no configuration action disappears', () => {
  const current = (manifest.actions ?? []).map((action) => action.key);
  for (const key of baseline.manifest.actions) {
    assert.ok(current.includes(key), `actions.${key}`);
  }
});
