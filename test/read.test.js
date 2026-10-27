import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readSystem,
  readHosts,
  readCalls,
  readNetHistory,
  normalizeMac,
  sensorId,
  hottest,
  readHomeNodes,
} from '../src/freebox/read.js';
import {
  SAMPLE_SYSTEM,
  LEGACY_SYSTEM,
  SAMPLE_HOSTS,
  SAMPLE_CALLS,
  NOW_S,
  netHistory,
} from './helpers/network.js';

test('readSystem reads the sensor and fan lists of recent firmwares', () => {
  const system = readSystem(SAMPLE_SYSTEM);
  assert.equal(system.firmware, '4.9.12');
  assert.equal(system.model, 'Freebox v7 (Delta)');
  assert.equal(system.uptimeSeconds, 3 * 86400 + 5 * 3600);
  assert.deepEqual(system.sensors, [
    { id: 'temp_cpu_cp_master', name: 'Température CPU', value: 62 },
    { id: 'temp_hdd0', name: 'Disque dur', value: 41 },
  ]);
  assert.deepEqual(system.fans, [{ id: 'fan0_speed', name: 'Ventilateur 1', value: 2140 }]);
  assert.equal(hottest(system.sensors), 62);
});

test('readSystem reads the fixed keys of older firmwares', () => {
  const system = readSystem(LEGACY_SYSTEM);
  assert.deepEqual(
    system.sensors.map((sensor) => [sensor.id, sensor.value]),
    [
      ['temp_cpum', 62],
      ['temp_cpub', 63],
      ['temp_sw', 52],
    ],
  );
  assert.deepEqual(system.fans, [{ id: 'fan_rpm', name: 'Ventilateur', value: 1832 }]);
  assert.equal(system.model, null);
});

test('readSystem never turns a missing value into 0', () => {
  const system = readSystem({
    sensors: [
      { id: 'temp_x', value: null },
      { id: '', value: 3 },
    ],
  });
  assert.deepEqual(system.sensors, []);
  assert.equal(system.uptimeSeconds, null);
  assert.deepEqual(readSystem(undefined).sensors, []);
  assert.equal(hottest([]), null);
});

test('sensorId and normalizeMac clean what the box sends', () => {
  assert.equal(sensorId('Temp-CPU M'), 'temp_cpu_m');
  assert.equal(normalizeMac('d0-23-db-36-15-aa'), 'D0:23:DB:36:15:AA');
  assert.equal(normalizeMac('d023db3615aa'), 'D0:23:DB:36:15:AA');
  assert.equal(normalizeMac('not a mac'), null);
  assert.equal(normalizeMac(undefined), null);
});

test('readHosts gives one entry per MAC address, with its connection', () => {
  const hosts = readHosts(SAMPLE_HOSTS);
  assert.equal(hosts.length, 4);
  const phone = hosts.find((host) => host.name === 'iPhone de Camille');
  assert.deepEqual(phone, {
    mac: 'D0:23:DB:36:15:AA',
    name: 'iPhone de Camille',
    ip: '192.168.1.20',
    vendor: null,
    active: true,
    medium: 'wifi',
    band: '5g',
    lastSeen: NOW_S * 1000,
    interface: 'pub',
  });
  assert.equal(hosts.find((host) => host.name === 'Freebox Player').medium, 'ethernet');
  assert.equal(hosts.find((host) => host.name === 'Tablette').active, false);
});

test('readHosts keeps the active entry of a host listed twice, and skips broken ones', () => {
  const hosts = readHosts([
    { ...SAMPLE_HOSTS[0], active: false, interface: 'wifiguest' },
    SAMPLE_HOSTS[0],
    { l2ident: { id: 'garbage' } },
    null,
  ]);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].active, true);
  assert.equal(hosts[0].interface, 'pub');
});

test('readHosts copes with hosts of older firmwares (no access point, no name)', () => {
  const [host] = readHosts([{ l2ident: { id: '00:11:22:33:44:55' }, active: true }]);
  assert.equal(host.name, '00:11:22:33:44:55');
  assert.equal(host.medium, null);
  assert.equal(host.ip, null);
  assert.equal(host.lastSeen, null);
});

test('readCalls sorts the log, most recent first, and skips unknown entries', () => {
  const calls = readCalls([
    ...SAMPLE_CALLS.slice().reverse(),
    { id: 1, type: 'voicemail', datetime: NOW_S },
    { id: 'x', type: 'missed', datetime: NOW_S },
  ]);
  assert.deepEqual(
    calls.map((call) => [call.id, call.type, call.name, call.isNew]),
    [
      [69, 'missed', 'Alice', true],
      [68, 'outgoing', '0102030405', false],
      [67, 'accepted', 'Bob', false],
    ],
  );
  assert.equal(calls[0].at, (NOW_S - 600) * 1000);
});

test('readNetHistory converts to Mbit/s and stays under the chart bounds', () => {
  const { down, up } = readNetHistory(netHistory(1440));
  assert.ok(down.length <= 120 && down.length >= 100, `${down.length} points`);
  assert.equal(down.length, up.length);
  assert.ok(down.every((point) => typeof point.v === 'number' && point.v >= 10));
  assert.equal(down[down.length - 1].t, new Date(NOW_S * 1000).toISOString());

  const single = readNetHistory([{ time: NOW_S, rate_down: 125000, rate_up: 0 }]);
  assert.deepEqual(single, {
    down: [{ t: new Date(NOW_S * 1000).toISOString(), v: 1 }],
    up: [{ t: new Date(NOW_S * 1000).toISOString(), v: 0 }],
  });
  assert.deepEqual(readNetHistory(null), { down: [], up: [] });
});

test('readHomeNodes keeps the name, category and state of each node', () => {
  assert.deepEqual(
    readHomeNodes([
      { id: 21, label: 'Volet salon', name: 'node_21', category: 'shutter', status: 'unreachable' },
      { id: 4, name: 'pir_4', category: 'PIR', status: 'ACTIVE' },
      { id: 'x', label: 'broken' },
      null,
    ]),
    [
      { id: 21, name: 'Volet salon', category: 'shutter', status: 'unreachable' },
      { id: 4, name: 'pir_4', category: 'pir', status: 'active' },
    ],
  );
  assert.deepEqual(readHomeNodes({ unexpected: true }), []);
});
