import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHomeHealth, CAUSES } from '../src/homeHealth.js';

const shutter = (id, status = 'active') => ({
  id,
  name: `Volet ${id}`,
  category: 'shutter',
  status,
});
const sensor = (id, status = 'active') => ({
  id,
  name: `Détecteur ${id}`,
  category: 'pir',
  status,
});

/** A tracker on a clock the test moves. */
function setup() {
  let now = 0;
  const health = createHomeHealth({ now: () => now });
  return {
    health,
    advance: (minutes) => {
      now += minutes * 60000;
    },
  };
}

test('a shutter unreachable for two readings opens one episode', () => {
  const { health } = setup();
  assert.equal(health.update({ nodes: [shutter(1), shutter(2)] }), null);
  assert.equal(health.update({ nodes: [shutter(1, 'unreachable'), shutter(2)] }), null);
  assert.deepEqual(health.update({ nodes: [shutter(1, 'unreachable'), shutter(2)] }), {
    event: 'unreachable',
    cause: CAUSES.DEVICES_UNREACHABLE,
    names: ['Volet 1'],
  });
  // Still lost: the episode is already open, no second event.
  assert.equal(health.update({ nodes: [shutter(1, 'unreachable'), shutter(2)] }), null);
  assert.equal(health.current().cause, CAUSES.DEVICES_UNREACHABLE);
});

test('a single lost reading is a blip, not an alarm', () => {
  const { health } = setup();
  health.update({ nodes: [shutter(1, 'unreachable')] });
  assert.equal(health.update({ nodes: [shutter(1)] }), null);
  assert.equal(health.update({ nodes: [shutter(1, 'unreachable')] }), null);
  assert.equal(health.current(), null);
});

test('the episode ends when every shutter is back, with its duration', () => {
  const { health, advance } = setup();
  health.update({ nodes: [shutter(1, 'unreachable')] });
  health.update({ nodes: [shutter(1, 'unreachable')] });
  advance(12);
  assert.deepEqual(health.update({ nodes: [shutter(1)] }), {
    event: 'reachable',
    cause: CAUSES.DEVICES_UNREACHABLE,
    names: [],
    minutes: 12,
  });
  assert.equal(health.current(), null);
});

test('only the shutters count: a sensor out of battery is no alarm', () => {
  const { health } = setup();
  health.update({ nodes: [shutter(1), sensor(2, 'unreachable')] });
  assert.equal(health.update({ nodes: [shutter(1), sensor(2, 'unreachable')] }), null);
});

test('a silent home API is an alarm only on a box where shutters were seen', () => {
  const noHome = setup().health;
  noHome.update({ error: 'Freebox home nodes unavailable' });
  assert.equal(noHome.update({ error: 'Freebox home nodes unavailable' }), null);

  const { health } = setup();
  health.update({ nodes: [shutter(1)] });
  health.update({ error: 'timeout' });
  assert.deepEqual(health.update({ error: 'timeout' }), {
    event: 'unreachable',
    cause: CAUSES.HOME_NOT_RESPONDING,
    names: [],
  });
});

test('a box that does not answer at all (rebooting) changes nothing', () => {
  const { health } = setup();
  health.update({ nodes: [shutter(1, 'unreachable')] });
  health.update({ nodes: [shutter(1, 'unreachable')] });
  assert.equal(health.update(null), null);
  assert.equal(health.update(null), null);
  assert.ok(health.current());
  // Still lost after the reboot: the same episode, no new event.
  assert.equal(health.update({ nodes: [shutter(1, 'unreachable')] }), null);
  assert.equal(health.update({ nodes: [shutter(1)] }).event, 'reachable');
});

test('a failed command opens an episode at the next reading, closed by a command that works', () => {
  const { health } = setup();
  health.update({ nodes: [shutter(1)] });
  health.commandResult(false, 'Volet salon');
  assert.deepEqual(health.update({ nodes: [shutter(1)] }), {
    event: 'unreachable',
    cause: CAUSES.COMMAND_FAILED,
    names: ['Volet salon'],
  });
  // The nodes look fine, but no command went through since: still open.
  assert.equal(health.update({ nodes: [shutter(1)] }), null);
  health.commandResult(true, 'Volet salon');
  assert.equal(health.update({ nodes: [shutter(1)] }).event, 'reachable');
});

test('reset forgets the episode and the shutters seen', () => {
  const { health } = setup();
  health.update({ nodes: [shutter(1, 'unreachable')] });
  health.update({ nodes: [shutter(1, 'unreachable')] });
  health.reset();
  assert.equal(health.current(), null);
  health.update({ error: 'timeout' });
  assert.equal(health.update({ error: 'timeout' }), null);
});
