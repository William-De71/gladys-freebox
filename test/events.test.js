import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TRIGGERS, SCENE_ACTIONS, callEvent, presenceEvent, wakeOnLanMac } from '../src/events.js';
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
