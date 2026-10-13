// -----------------------------------------------------------------------------
// index.js end to end, against the fake Gladys of the SDK.
//
// index.js builds its own `GladysIntegration` and connects on import, so the
// SDK module is mocked to hand it the fake instead, and the two modules that
// reach the box (the Freebox client and the camera capture) are mocked to
// answer the sample nodes of test/helpers/samples.js. Nothing touches the
// network.
//
// Needs `--experimental-test-module-mocks` (see the `test` script).
// -----------------------------------------------------------------------------

import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import * as sdk from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { SAMPLE_NODES, SAMPLE_PLAYERS } from './helpers/samples.js';

const IMAGE = 'image/jpg;base64,/9j/AAAA';

// What the box answers, endpoint by endpoint, for each node; edited by the tests.
const nodeValues = {
  12: [
    { ep_id: 6, value: true },
    { ep_id: 7, value: false },
    { ep_id: 8, value: 80 },
  ],
};
const player = { power_state: 'running', volume: 25, mute: false };
const connection = { state: 'up', media: 'ftth', rate_down: 2500000, rate_up: 125000 };

const gladys = createFakeGladys({ selector: 'ext-dev-freebox', config: { app_token: 'token' } });

const { default: _default, ...namedExports } = sdk;
mock.module('@gladysassistant/integration-sdk', {
  namedExports: {
    ...namedExports,
    GladysIntegration: function GladysIntegration() {
      return gladys;
    },
  },
});
mock.module('../src/freebox/FreeboxClient.js', {
  namedExports: {
    FreeboxClient: class {
      async loadDevices() {
        return Object.values(SAMPLE_NODES);
      }
      async loadPlayers() {
        return Object.values(SAMPLE_PLAYERS);
      }
      async loadNodeValues(_appToken, nodeId) {
        return nodeValues[nodeId] ?? [];
      }
      async playerRequest(_appToken, { path }) {
        if (path.endsWith('/status/')) {
          return {
            status: 200,
            data: { success: true, result: { power_state: player.power_state } },
          };
        }
        return {
          status: 200,
          data: { success: true, result: { volume: player.volume, mute: player.mute } },
        };
      }
      async loadConnectionStatus() {
        return { ...connection };
      }
      reset() {}
    },
  },
});
mock.module('../src/freebox/camera.js', {
  namedExports: { captureCameraImage: async () => IMAGE, normalizeCameraUrl: (url) => url },
});

await import('../index.js');
// index.js connects on its own: wait for its `connected` handler to settle.
for (let i = 0; i < 100 && gladys.fake.connectionStatuses.length === 0; i += 1) {
  await sleep(10);
}

after(() => gladys.fake.shutdown());

/** The discovered device whose external id ends with `suffix`. */
const discovered = (suffix) =>
  gladys.fake.discoveredDevices.find((device) => device.external_id.endsWith(`:${suffix}`));

/** The states published for one feature, in order. */
const statesOf = (externalId) =>
  gladys.fake.states
    .filter((state) => state.device_feature_external_id === externalId)
    .map((state) => state.state ?? state.text);

test('once connected and paired, every sample device is discovered', () => {
  assert.equal(
    gladys.fake.discoveredDevices.length,
    // + the Freebox Server, for the internet connection.
    Object.keys(SAMPLE_NODES).length + Object.keys(SAMPLE_PLAYERS).length + 1,
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a sensor just created gets its current state at once, without waiting for a change', async () => {
  const sensor = discovered('freebox:12');
  await gladys.fake.deviceCreated(sensor);

  assert.deepEqual(statesOf(`${sensor.external_id}:6`), [1], 'door closed');
  assert.deepEqual(statesOf(`${sensor.external_id}:7`), [0], 'casing shut');
  assert.deepEqual(statesOf(`${sensor.external_id}:8`), [80], 'battery');
});

test('a poll publishes only the values that changed', async () => {
  const sensor = discovered('freebox:12');
  const before = gladys.fake.states.length;

  assert.equal((await gladys.fake.poll(sensor)).success, true);
  assert.equal(gladys.fake.states.length, before, 'nothing changed, nothing sent');

  nodeValues[12][0].value = false; // the door opens
  await gladys.fake.poll(sensor);
  assert.deepEqual(statesOf(`${sensor.external_id}:6`), [1, 0]);
  assert.deepEqual(statesOf(`${sensor.external_id}:8`), [80], 'the battery is not sent again');
});

test('a player just created gets its power, volume and mute at once', async () => {
  const device = discovered('freebox:player:1');
  await gladys.fake.deviceCreated(device);

  assert.deepEqual(statesOf(`${device.external_id}:binary`), [1]);
  assert.deepEqual(statesOf(`${device.external_id}:volume`), [25]);
  assert.deepEqual(statesOf(`${device.external_id}:volume-mute`), [0]);
});

test('a camera just created gets a first image at once', async () => {
  const camera = discovered('freebox:30');
  await gladys.fake.deviceCreated(camera);

  const images = gladys.fake.cameraImages.filter(
    (entry) => (entry.device_external_id ?? entry.external_id) === camera.external_id,
  );
  assert.equal(images.length, 1);
});

test('the Freebox Server reports the internet connection, and its loss', async () => {
  const server = discovered('freebox:server');
  await gladys.fake.deviceCreated(server);

  assert.deepEqual(statesOf(`${server.external_id}:connection`), ['up']);
  assert.deepEqual(statesOf(`${server.external_id}:rate-down`), [20]);
  assert.deepEqual(statesOf(`${server.external_id}:rate-up`), [1]);

  Object.assign(connection, { state: 'down', rate_down: 0, rate_up: 0 });
  await gladys.fake.poll(server);
  assert.deepEqual(statesOf(`${server.external_id}:connection`), ['up', 'down']);
  assert.deepEqual(statesOf(`${server.external_id}:rate-down`), [20, 0]);
});
