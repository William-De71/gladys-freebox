import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWatcher } from '../src/watcher.js';
import { SAMPLE_HOSTS, SAMPLE_CALLS, NOW_S } from './helpers/network.js';

const silent = { info() {}, warn() {}, debug() {} };

/**
 * A watcher on a fake client whose answers the test edits.
 * @param {object} [options] - Options.
 * @returns {object} `{ watcher, box, rounds, logs }`.
 */
function setup({ token = 'token' } = {}) {
  const box = {
    hosts: [...SAMPLE_HOSTS],
    hostsFail: false,
    calls: [...SAMPLE_CALLS],
    callsError: null,
  };
  const rounds = [];
  const logs = [];
  const client = {
    loadLanHosts: async () => {
      if (box.hostsFail) {
        throw new Error('Freebox request timeout');
      }
      return box.hosts;
    },
    loadCallLog: async () => {
      if (box.callsError) {
        const error = new Error(box.callsError);
        error.code = box.callsError;
        throw error;
      }
      return box.calls;
    },
  };
  const watcher = createWatcher({
    client,
    getAppToken: async () => token,
    onRound: async (round) => rounds.push(round),
    logger: { ...silent, info: (message) => logs.push(message) },
    now: () => NOW_S * 1000,
  });
  return { watcher, box, rounds, logs };
}

test('the first round reads both lists without any transition', async () => {
  const { watcher, rounds } = setup();
  await watcher.runNow();
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0].presence, []);
  assert.deepEqual(rounds[0].calls, []);
  assert.equal(rounds[0].hostsChanged, false);
  const snapshot = watcher.snapshot();
  assert.equal(snapshot.hosts.length, 4);
  assert.equal(snapshot.calls.length, 3);
  assert.equal(snapshot.callsError, null);
});

test('the next rounds report the new calls and the presence changes', async () => {
  const { watcher, box, rounds } = setup();
  await watcher.runNow();
  box.calls = [
    { id: 70, type: 'missed', number: '0611', name: 'Carol', datetime: NOW_S, new: true },
    ...SAMPLE_CALLS,
  ];
  box.hosts = [{ ...SAMPLE_HOSTS[0], active: false }, ...SAMPLE_HOSTS.slice(1)];
  await watcher.runNow();
  const round = rounds[1];
  assert.deepEqual(
    round.calls.map((call) => call.id),
    [70],
  );
  assert.deepEqual(
    round.presence.map(({ host, event }) => [host.name, event]),
    [['iPhone de Camille', 'disconnected']],
  );
  assert.equal(round.hostsChanged, true);
  assert.equal(round.callsChanged, true);
});

test('a missing permission is remembered, logged once, and the log starts over', async () => {
  const { watcher, box, rounds, logs } = setup();
  await watcher.runNow();
  box.callsError = 'insufficient_rights';
  await watcher.runNow();
  await watcher.runNow();
  assert.equal(watcher.snapshot().callsError, 'insufficient_rights');
  assert.equal(watcher.snapshot().calls, null);
  assert.equal(logs.filter((line) => line.includes('Call log access')).length, 1);

  // Permission granted again: a baseline, not a replay of the whole log.
  box.callsError = null;
  await watcher.runNow();
  assert.deepEqual(rounds[3].calls, []);
  assert.equal(watcher.snapshot().calls.length, 3);
});

test('a failed host reading keeps the previous snapshot, without a false departure', async () => {
  const { watcher, box, rounds } = setup();
  await watcher.runNow();
  box.hostsFail = true;
  await watcher.runNow();
  assert.equal(watcher.snapshot().hosts.length, 4);
  assert.deepEqual(rounds[1].presence, []);
  assert.equal(rounds[1].hostsChanged, false);
});

test('nothing is read while the Freebox is not paired', async () => {
  const { watcher, rounds } = setup({ token: null });
  await watcher.runNow();
  assert.equal(rounds.length, 0);
  assert.equal(watcher.snapshot().hosts, null);
});

test('concurrent calls share one round', async () => {
  const { watcher, rounds } = setup();
  await Promise.all([watcher.runNow(), watcher.runNow()]);
  assert.equal(rounds.length, 1);
});

test('reset forgets the lists: the next round is a baseline again', async () => {
  const { watcher, box, rounds } = setup();
  await watcher.runNow();
  watcher.reset();
  box.hosts = [{ ...SAMPLE_HOSTS[0], active: false }, ...SAMPLE_HOSTS.slice(1)];
  await watcher.runNow();
  assert.deepEqual(rounds[1].presence, []);
});
