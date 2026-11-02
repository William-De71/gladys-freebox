import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createShutterCheck } from '../src/shutterCheck.js';

/** A checker on hand-run timers, reading positions from a map. */
function setup(positions = {}) {
  const timers = new Map();
  let next = 0;
  const results = [];
  const check = createShutterCheck({
    readPosition: async (nodeId) => {
      const position = positions[nodeId];
      if (position instanceof Error) {
        throw position;
      }
      return position;
    },
    onResult: (result) => {
      results.push(result);
    },
    setTimer: (fn) => {
      next += 1;
      timers.set(next, fn);
      return next;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    check,
    results,
    positions,
    pending: () => timers.size,
    // Run every timer due, then let the reading settle.
    elapse: async () => {
      const due = [...timers.values()];
      timers.clear();
      due.forEach((fn) => fn());
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    },
  };
}

const move = (target, nodeId = '30') => ({ nodeId, endpointId: '3', target, name: 'Volet salon' });

test('a shutter at its target is a move that happened', async () => {
  const { check, results, elapse } = setup({ 30: 100 });
  check.watch(move(100));
  await elapse();
  assert.deepEqual(results, [{ ok: true, name: 'Volet salon', position: 100, target: 100 }]);
});

test('a shutter a few points short still moved', async () => {
  const { check, results, elapse } = setup({ 30: 97 });
  check.watch(move(100));
  await elapse();
  assert.equal(results[0].ok, true);
});

test('a shutter that stayed put is a missed move', async () => {
  const { check, results, elapse } = setup({ 30: 0 });
  check.watch(move(100));
  await elapse();
  assert.deepEqual(results, [{ ok: false, name: 'Volet salon', position: 0, target: 100 }]);
});

test('a newer command on the same shutter replaces the pending check', async () => {
  const { check, results, pending, elapse } = setup({ 30: 0 });
  check.watch(move(100));
  check.watch(move(0));
  assert.equal(pending(), 1);
  await elapse();
  assert.deepEqual(
    results.map((r) => r.target),
    [0],
  );
});

test('cancel (a stop) drops the check, other shutters keep theirs', async () => {
  const { check, results, elapse } = setup({ 30: 0, 31: 100 });
  check.watch(move(100, '30'));
  check.watch(move(100, '31'));
  check.cancel('30');
  await elapse();
  assert.equal(results.length, 1);
  assert.equal(results[0].position, 100);
});

test('no verdict when the position cannot be read', async () => {
  const { check, results, elapse } = setup({ 30: new Error('timeout'), 31: null });
  check.watch(move(100, '30'));
  check.watch(move(100, '31'));
  await elapse();
  assert.deepEqual(results, []);
});

test('stop forgets every check', async () => {
  const { check, results, pending, elapse } = setup({ 30: 0 });
  check.watch(move(100));
  check.stop();
  assert.equal(pending(), 0);
  await elapse();
  assert.deepEqual(results, []);
});
