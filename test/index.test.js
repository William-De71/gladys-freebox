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
import { SAMPLE_SYSTEM, SAMPLE_HOSTS, SAMPLE_CALLS, NOW_S, netHistory } from './helpers/network.js';

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
// The rest of the box, edited by the tests; `requests` records the writes.
const box = {
  wifi: true,
  hosts: [...SAMPLE_HOSTS],
  calls: SAMPLE_CALLS.map((call) => ({ ...call })),
  requests: [],
};

/**
 * An error shaped like the ones of FreeboxClient.resultOf().
 * @param {string} code - The Freebox error code.
 * @returns {Error} The error.
 */
const refused = (code) => Object.assign(new Error(`refused (${code})`), { code });

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
      async loadSystem() {
        return SAMPLE_SYSTEM;
      }
      async loadWifiConfig() {
        return { enabled: box.wifi };
      }
      async setWifiEnabled(_appToken, enabled) {
        box.requests.push(['wifi', enabled]);
        if (box.settingsRefused) {
          throw refused('insufficient_rights');
        }
        box.wifi = enabled;
        return { enabled };
      }
      async reboot() {
        box.requests.push(['reboot']);
      }
      async loadNetHistory() {
        return netHistory(240);
      }
      async loadLanHosts() {
        return box.hosts;
      }
      async loadCallLog() {
        return box.calls;
      }
      async markCallsAsRead() {
        box.requests.push(['mark_read']);
        box.calls.forEach((call) => {
          call.new = false;
        });
      }
      async wakeOnLan(_appToken, mac, lanInterface) {
        box.requests.push(['wol', mac, lanInterface]);
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

test('the Freebox Server gets its Wi-Fi switch and its temperatures', async () => {
  const server = discovered('freebox:server');
  assert.ok(server.features.some((f) => f.external_id.endsWith(':wifi')));
  assert.ok(server.features.some((f) => f.external_id.endsWith(':temp-temp_cpu_cp_master')));
  // The device created above has every feature: its first poll filled them.
  assert.deepEqual(statesOf(`${server.external_id}:wifi`), [1]);
  assert.deepEqual(statesOf(`${server.external_id}:temp-temp_cpu_cp_master`), [62]);
});

test('the Wi-Fi switch of the Freebox Server turns the Wi-Fi off and reports it', async () => {
  const server = discovered('freebox:server');
  const wifi = server.features.find((f) => f.external_id.endsWith(':wifi'));
  const ack = await gladys.fake.setValue(server, wifi, 0);
  assert.equal(ack.success, true);
  assert.deepEqual(box.requests.at(-1), ['wifi', false]);
  assert.deepEqual(statesOf(wifi.external_id), [1, 0]);
  await gladys.fake.setValue(server, wifi, 1);
  assert.deepEqual(statesOf(wifi.external_id), [1, 0, 1]);
});

test('a read-only feature of the Freebox Server refuses a command', async () => {
  const server = discovered('freebox:server');
  const rate = server.features.find((f) => f.external_id.endsWith(':rate-down'));
  const ack = await gladys.fake.setValue(server, rate, 3);
  assert.equal(ack.success, false);
});

test('the box widget shows the rates, the history and the buttons', async () => {
  Object.assign(connection, { state: 'up', rate_down: 2500000, rate_up: 125000 });
  const ack = await gladys.fake.widgetGet('box', { language: 'fr', settings: { period: 'hour' } });
  assert.equal(ack.success, true);
  const { components } = ack.data.content;
  assert.deepEqual(
    components.map((c) => c.type),
    ['text', 'value', 'value', 'value', 'chart', 'status', 'button', 'button'],
  );
  const devices = components
    .find((c) => c.type === 'status')
    .items.find((item) => item.icon === 'smartphone');
  assert.equal(devices.value, 3);
});

test('the box widget buttons switch the Wi-Fi and reboot, with a toast', async () => {
  let ack = await gladys.fake.widgetAction('box', 'wifi_off');
  assert.equal(ack.success, true);
  assert.equal(box.wifi, false);
  assert.match(JSON.stringify(ack.data.message), /Wi-Fi turned off/);
  const server = discovered('freebox:server');
  assert.equal(statesOf(`${server.external_id}:wifi`).at(-1), 0, 'the switch follows');

  ack = await gladys.fake.widgetAction('box', 'wifi_on');
  assert.equal(box.wifi, true);
  assert.match(JSON.stringify(ack.data.message), /Wi-Fi turned on/);

  box.settingsRefused = true;
  ack = await gladys.fake.widgetAction('box', 'wifi_off');
  assert.match(JSON.stringify(ack.data.message), /Freebox settings modification/);
  box.settingsRefused = false;

  ack = await gladys.fake.widgetAction('box', 'reboot');
  assert.deepEqual(box.requests.at(-1), ['reboot']);
  assert.match(JSON.stringify(ack.data.message), /Reboot requested/);
});

test('the network widget lists the devices connected now', async () => {
  const ack = await gladys.fake.widgetGet('network');
  const list = ack.data.content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Freebox Player', 'iPhone de Camille', 'MacBook'],
  );
});

test('a new call fires the trigger, and the read button clears the unread calls', async () => {
  let ack = await gladys.fake.widgetGet('calls');
  assert.equal(ack.data.content.components[0].text, '1 unread missed call(s)');

  box.calls.unshift({
    id: 70,
    type: 'missed',
    number: '0611223344',
    name: 'Carol',
    duration: 0,
    datetime: NOW_S,
    new: true,
  });
  box.hosts = [{ ...SAMPLE_HOSTS[0], active: false }, ...SAMPLE_HOSTS.slice(1)];
  const before = gladys.fake.sceneEvents.length;

  // The read button reads the box again before the core refetches the card:
  // that round sees the new call and the phone gone.
  ack = await gladys.fake.widgetAction('calls', 'mark_calls_read');
  assert.equal(ack.success, true);
  assert.deepEqual(box.requests.at(-1), ['mark_read']);

  const fired = gladys.fake.sceneEvents.slice(before);
  assert.deepEqual(fired, [
    {
      key: 'phone_call',
      data: { call_type: 'missed', number: '0611223344', name: 'Carol', duration: 0 },
    },
    {
      key: 'network_device_presence',
      data: {
        event: 'disconnected',
        mac: 'D0:23:DB:36:15:AA',
        name: 'iPhone de Camille',
        ip: '192.168.1.20',
        connection: 'wifi',
        vendor: '',
      },
    },
  ]);
  assert.ok(gladys.fake.widgetRefreshes.includes('calls'));
  assert.ok(gladys.fake.widgetRefreshes.includes('network'));

  ack = await gladys.fake.widgetGet('calls');
  assert.equal(ack.data.content.components[0].text, 'No unread missed call');
});

test('the Wake-on-LAN scene action wakes the host on its interface', async () => {
  let ack = await gladys.fake.sceneAction('wake_on_lan', { mac: '3c-22-fb-11-22-33' });
  assert.equal(ack.success, true);
  assert.deepEqual(box.requests.at(-1), ['wol', '3C:22:FB:11:22:33', 'pub']);

  ack = await gladys.fake.sceneAction('wake_on_lan', { mac: 'my computer' });
  assert.equal(ack.success, false);
});
