import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertDevice,
  convertFeature,
  convertPlayer,
  getPlayerBaseUrl,
} from '../src/freebox/convert.js';

test('convertFeature maps an opening trigger to an opening sensor', () => {
  const feature = convertFeature(
    { ep_id: 1, name: 'trigger', label: 'État', ui: { access: 'r' } },
    'freebox:12',
  );
  assert.equal(feature.category, 'opening-sensor');
  assert.equal(feature.type, 'binary');
  assert.equal(feature.external_id, 'freebox:12:1');
  assert.equal(feature.read_only, true);
});

test('convertFeature maps a detection trigger to a motion sensor', () => {
  const feature = convertFeature(
    { ep_id: 2, name: 'trigger', label: 'Détection', ui: null },
    'freebox:12',
  );
  assert.equal(feature.category, 'motion-sensor');
  assert.equal(feature.read_only, false);
});

test('convertFeature scales battery and position to 0-100', () => {
  const battery = convertFeature({ ep_id: 3, name: 'battery_warning', ui: null }, 'freebox:12');
  assert.equal(battery.max, 100);
  const position = convertFeature({ ep_id: 4, name: 'position', ui: null }, 'freebox:12');
  assert.equal(position.max, 100);
});

test('convertFeature returns undefined for an unmanaged function', () => {
  const feature = convertFeature({ ep_id: 5, name: 'nope', ui: null }, 'freebox:12');
  assert.equal(feature, undefined);
});

test('convertDevice groups tiles by node and keeps managed features', () => {
  const device = convertDevice({
    node_id: 12,
    specifications: [
      {
        node_id: 12,
        label: 'Porte entrée',
        type: 'sensor',
        action: 'door',
        data: [
          { ep_id: 1, name: 'trigger', label: 'État', ui: { access: 'r' } },
          { ep_id: 9, name: 'unmanaged', ui: null },
        ],
      },
    ],
  });
  assert.equal(device.external_id, 'freebox:12');
  assert.equal(device.name, 'Porte entrée');
  assert.equal(device.model, 'door');
  assert.equal(device.should_poll, true);
  assert.equal(device.features.length, 1);
  assert.equal(device.features[0].external_id, 'freebox:12:1');
});

test('convertDevice attaches a CAMERA_URL param for camera devices', () => {
  const device = convertDevice({
    node_id: 20,
    specifications: [
      {
        node_id: 20,
        label: 'Caméra',
        type: 'camera',
        data: [{ ep_id: 1, name: 'cam', value: 'http://mafreebox/stream.m3u8', ui: null }],
      },
    ],
  });
  const camParam = device.params.find((p) => p.name === 'CAMERA_URL');
  assert.equal(camParam.value, 'http://mafreebox/stream.m3u8');
  assert.equal(device.features[0].category, 'camera');
});

test('convertPlayer builds a television device with media features', () => {
  const device = convertPlayer({ id: 1, device_name: 'Player Salon', api_version: '7.0' });
  assert.equal(device.external_id, 'freebox:player:1');
  assert.equal(device.model, 'player');
  const apiParam = device.params.find((p) => p.name === 'PLAYER_API_VERSION');
  assert.equal(apiParam.value, 'v7');
  const power = device.features.find((f) => f.type === 'binary');
  assert.equal(power.read_only, true);
  const volume = device.features.find((f) => f.type === 'volume');
  assert.equal(volume.max, 100);
});

test('getPlayerBaseUrl uses the stored API version, defaulting to v6', () => {
  assert.equal(
    getPlayerBaseUrl({
      external_id: 'freebox:player:1',
      params: [{ name: 'PLAYER_API_VERSION', value: 'v8' }],
    }),
    '/player/1/api/v8',
  );
  assert.equal(
    getPlayerBaseUrl({ external_id: 'freebox:player:2', params: [] }),
    '/player/2/api/v6',
  );
});

// `name` is NOT NULL in Gladys: a device published without a name is rejected
// when the user creates it from the discovery screen.
test('convertPlayer falls back on a name when the Freebox sends none', () => {
  const missing = convertPlayer({ id: 3, api_version: '7.0' });
  assert.equal(missing.name, 'Freebox Player 3');

  const empty = convertPlayer({ id: 4, device_name: '', api_version: '7.0' });
  assert.equal(empty.name, 'Freebox Player 4');
});

// The Gladys core generates the feature selector with slugify(name) and that
// column is UNIQUE across the whole table: plain names like "Volume" or "Play"
// collide with other integrations (and between two players), which makes the
// device creation fail with a generic error in the UI.
test('convertPlayer publishes unique selectors, never plain feature names', () => {
  const device = convertPlayer({ id: 1, device_name: 'Player Salon', api_version: '7.0' });

  assert.equal(device.selector, 'freebox-player-1');
  const volume = device.features.find((f) => f.type === 'volume');
  assert.equal(volume.selector, 'freebox-player-1-volume');
  assert.equal(volume.name, 'Volume', 'the display name stays readable');

  // Two different players must never share a selector.
  const other = convertPlayer({ id: 2, device_name: 'Player Salon', api_version: '7.0' });
  const selectors = [...device.features, ...other.features].map((f) => f.selector);
  assert.equal(new Set(selectors).size, selectors.length, 'all feature selectors are unique');
  assert.notEqual(device.selector, other.selector);
});

test('convertDevice publishes unique selectors for home devices', () => {
  const device = convertDevice({
    specifications: [
      {
        node_id: 12,
        label: 'Volet',
        type: 'basic_shutter',
        action: 'store',
        data: [{ ep_id: 3, name: 'position', ui: { access: 'rw' } }],
      },
    ],
  });
  assert.equal(device.selector, 'freebox-12');
  assert.equal(device.features[0].selector, 'freebox-12-3-position');
});

// The id builds every external_id and selector: publishing a player without one
// would produce "freebox:player:undefined". Player id 0 is valid.
test('convertPlayer rejects a player without id but accepts id 0', () => {
  assert.throws(() => convertPlayer({ device_name: 'Ghost' }), /without id/);
  assert.throws(() => convertPlayer({ id: null, device_name: 'Ghost' }), /without id/);

  const first = convertPlayer({ id: 0, device_name: 'Player', api_version: '7.0' });
  assert.equal(first.external_id, 'freebox:player:0');
  assert.equal(first.selector, 'freebox-player-0');
});

test('convertPlayer keeps the default API version when none is advertised', () => {
  const device = convertPlayer({ id: 1, device_name: 'Player Salon' });
  const apiParam = device.params.find((p) => p.name === 'PLAYER_API_VERSION');
  assert.equal(apiParam.value, 'v6');
});

test('convertDevice falls back on a name when the tile has no label', () => {
  const device = convertDevice({
    node_id: 12,
    specifications: [{ node_id: 12, type: 'basic_shutter', data: [] }],
  });
  assert.equal(device.name, 'Freebox 12');
});
