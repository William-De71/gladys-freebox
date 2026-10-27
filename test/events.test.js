import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TRIGGERS,
  SCENE_ACTIONS,
  REBOOT_MIN_INTERVAL,
  callEvent,
  presenceEvent,
  homeEvent,
  rebootAllowed,
  wakeOnLanMac,
} from '../src/events.js';
import { readHosts, readCalls, CALL_TYPES } from '../src/freebox/read.js';
import { SAMPLE_HOSTS, SAMPLE_CALLS } from './helpers/network.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const trigger = (key) => manifest.scene_triggers.find((entry) => entry.key === key);

/**
 * Check an event against the bounds of the core and its declaration.
 * @param {{ key: string, data: object }} event - The event.
 */
function assertFits(event) {
  const declared = trigger(event.key);
  assert.ok(declared, `trigger ${event.key} is declared`);
  const keys = Object.keys(event.data);
  assert.ok(keys.length <= 30);
  for (const [key, value] of Object.entries(event.data)) {
    assert.ok(
      value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 1000),
      `${event.key}.${key}`,
    );
  }
  // Every filter and every variable is carried by the event.
  for (const { key } of [...(declared.fields ?? []), ...(declared.variables ?? [])]) {
    assert.ok(keys.includes(key), `${event.key}: ${key} missing from the data`);
  }
  for (const variable of declared.variables ?? []) {
    assert.equal(typeof event.data[variable.key], variable.type, `${event.key}.${variable.key}`);
  }
}

test('the manifest declares exactly the triggers and actions the code handles', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((entry) => entry.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((entry) => entry.key),
    Object.values(SCENE_ACTIONS),
  );
});

test('a call event carries its type, number, name and duration', () => {
  const [missed, outgoing] = readCalls(SAMPLE_CALLS);
  assert.deepEqual(callEvent(missed), {
    key: 'phone_call',
    data: { call_type: 'missed', number: '0612345678', name: 'Alice', duration: 0 },
  });
  assertFits(callEvent(outgoing));
});

test('the call type filter offers exactly the types the box logs', () => {
  const field = trigger('phone_call').fields.find((entry) => entry.key === 'call_type');
  assert.deepEqual(
    field.options.map((option) => option.value),
    CALL_TYPES,
  );
});

test('a presence event carries the host and the direction', () => {
  const [phone] = readHosts(SAMPLE_HOSTS);
  const event = presenceEvent({ host: phone, event: 'connected' });
  assert.deepEqual(event, {
    key: 'network_device_presence',
    data: {
      event: 'connected',
      mac: 'D0:23:DB:36:15:AA',
      name: 'iPhone de Camille',
      ip: '192.168.1.20',
      connection: 'wifi',
      vendor: '',
    },
  });
  assertFits(event);
  const field = trigger('network_device_presence').fields.find((entry) => entry.key === 'event');
  assert.deepEqual(
    field.options.map((option) => option.value),
    ['connected', 'disconnected'],
  );
});

test('a host without address nor vendor still fits', () => {
  const [host] = readHosts([{ l2ident: { id: '00:11:22:33:44:55' }, active: false }]);
  assertFits(presenceEvent({ host, event: 'disconnected' }));
});

test('Wake-on-LAN takes a MAC address in any usual form, and refuses anything else', () => {
  assert.equal(wakeOnLanMac({ mac: 'd0-23-db-36-15-aa' }), 'D0:23:DB:36:15:AA');
  assert.equal(wakeOnLanMac({ mac: ' D0:23:DB:36:15:AA ' }), 'D0:23:DB:36:15:AA');
  assert.throws(() => wakeOnLanMac({ mac: 'computer' }), /not a MAC address/);
  assert.throws(() => wakeOnLanMac({}), /not a MAC address/);
});

test('the Wake-on-LAN action declares only its MAC address, required', () => {
  const [action] = manifest.scene_actions;
  assert.deepEqual(
    action.fields.map((field) => [field.key, field.type, field.required]),
    [['mac', 'string', true]],
  );
  assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
});

test('a home event names the shutters lost, and the outage length once back', () => {
  const lost = homeEvent({
    event: 'unreachable',
    cause: 'devices_unreachable',
    names: ['Volet salon', 'Volet chambre'],
  });
  assert.deepEqual(lost, {
    key: 'home_reachability',
    data: {
      event: 'unreachable',
      cause: 'devices_unreachable',
      count: 2,
      names: 'Volet salon, Volet chambre',
      minutes: 0,
    },
  });
  assertFits(lost);
  const back = homeEvent({
    event: 'reachable',
    cause: 'home_not_responding',
    names: [],
    minutes: 7,
  });
  assert.equal(back.data.minutes, 7);
  assertFits(back);
  const field = trigger('home_reachability').fields.find((entry) => entry.key === 'event');
  assert.deepEqual(
    field.options.map((option) => option.value),
    ['unreachable', 'reachable'],
  );
});

test('the reboot action waits its minimum interval between two reboots', () => {
  const now = 10 * 3600000;
  assert.deepEqual(rebootAllowed({}, null, now), {
    allowed: true,
    minutesAgo: null,
    interval: REBOOT_MIN_INTERVAL.DEFAULT,
  });
  assert.deepEqual(rebootAllowed({ min_interval_minutes: 60 }, now - 10 * 60000, now), {
    allowed: false,
    minutesAgo: 10,
    interval: 60,
  });
  assert.equal(rebootAllowed({ min_interval_minutes: 60 }, now - 61 * 60000, now).allowed, true);
  // Out of bounds: clamped, never a reboot loop every minute.
  assert.equal(rebootAllowed({ min_interval_minutes: 1 }, null, now).interval, 15);
  assert.equal(rebootAllowed({ min_interval_minutes: null }, null, now).interval, 60);
});

test('the reboot action declares its optional interval, within the bounds of the code', () => {
  const action = manifest.scene_actions.find((entry) => entry.key === 'reboot');
  assert.deepEqual(
    action.fields.map((field) => [field.key, field.type, field.required]),
    [['min_interval_minutes', 'number', false]],
  );
  const [field] = action.fields;
  assert.equal(field.default, REBOOT_MIN_INTERVAL.DEFAULT);
  assert.equal(field.min, REBOOT_MIN_INTERVAL.MIN);
  assert.equal(field.max, REBOOT_MIN_INTERVAL.MAX);
  assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
});
