import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffPresence, newCalls, hostsSignature, callsSignature } from '../src/tracker.js';
import { readHosts, readCalls } from '../src/freebox/read.js';
import { SAMPLE_HOSTS, SAMPLE_CALLS, NOW_S, lanHost } from './helpers/network.js';

const hosts = readHosts(SAMPLE_HOSTS);
const calls = readCalls(SAMPLE_CALLS);

test('the first reading is a baseline: no transition at all', () => {
  assert.deepEqual(diffPresence(null, hosts), []);
  assert.deepEqual(newCalls(null, calls), []);
});

test('diffPresence reports the hosts that connected and the ones that left', () => {
  const next = readHosts([
    // the phone leaves, the tablet comes back
    { ...SAMPLE_HOSTS[0], active: false },
    SAMPLE_HOSTS[1],
    SAMPLE_HOSTS[2],
    { ...SAMPLE_HOSTS[3], active: true },
    // a host never seen, connected
    lanHost({ mac: '11:22:33:44:55:66', name: 'Console', ip: '192.168.1.60' }),
  ]);
  assert.deepEqual(
    diffPresence(hosts, next).map(({ host, event }) => [host.name, event]),
    [
      ['Tablette', 'connected'],
      ['Console', 'connected'],
      ['iPhone de Camille', 'disconnected'],
    ],
  );
});

test('diffPresence: a connected host the box forgot has left', () => {
  const next = hosts.filter((host) => host.name !== 'MacBook');
  assert.deepEqual(
    diffPresence(hosts, next).map(({ host, event }) => [host.name, event, host.active]),
    [['MacBook', 'disconnected', false]],
  );
});

test('diffPresence: nothing moved, nothing reported', () => {
  assert.deepEqual(diffPresence(hosts, readHosts(SAMPLE_HOSTS)), []);
});

test('newCalls reports the calls that entered the log, oldest first', () => {
  const next = readCalls([
    { id: 71, type: 'accepted', number: '0611', name: 'Carol', datetime: NOW_S + 120 },
    { id: 70, type: 'missed', number: '0612345678', name: 'Alice', datetime: NOW_S + 60 },
    ...SAMPLE_CALLS,
  ]);
  assert.deepEqual(
    newCalls(calls, next).map((call) => call.id),
    [70, 71],
  );
});

test('newCalls never brings back old calls when the log is emptied and refilled', () => {
  const next = readCalls([
    // an old call the box re-lists with a new id
    { id: 99, type: 'missed', number: '0600', datetime: NOW_S - 90000 },
  ]);
  assert.deepEqual(newCalls(calls, next), []);
  assert.deepEqual(newCalls(calls, []), []);
});

test('the signatures change with what the widgets show', () => {
  const moved = hosts.map((host) => (host.name === 'MacBook' ? { ...host, band: '5g' } : host));
  assert.notEqual(hostsSignature(hosts), hostsSignature(moved));
  // a disconnected host is not shown as connected: its details do not count
  const offline = hosts.map((host) => (host.active ? host : { ...host, ip: '192.168.1.99' }));
  assert.equal(hostsSignature(hosts), hostsSignature(offline));

  const read = calls.map((call) => ({ ...call, isNew: false }));
  assert.notEqual(callsSignature(calls), callsSignature(read));
  assert.equal(callsSignature(null), '');
});
