// -----------------------------------------------------------------------------
// Health of the home automation of the box (pure logic, tested alone).
//
// The Freebox Delta drives io-homecontrol shutters itself, and its home system
// is known to lose them after a while: the box marks the shutters
// `unreachable`, its home API stops answering, a command is refused, or —
// silently — commands are accepted but the shutters no longer move (see
// shutterCheck.js) — until the box is rebooted. This module turns the readings of the watch loop and the
// outcome of the shutter commands into ONE event per episode: `unreachable`
// when the problem starts, `reachable` when it is over. A scene can then warn
// the user or reboot the box.
//
// Guards against false alarms:
//   - a node or home API problem must last CONFIRM_ROUNDS readings in a row;
//   - a shutter that did not reach its position must happen MISSED_MOVES
//     times in a row (a hand on the remote, an obstacle);
//   - the home API is only said to be silent on a box where shutters were
//     seen before (a Revolution, a Pop or an Ultra has no home system);
//   - a round where the whole box is silent (rebooting) changes nothing: the
//     episode only ends on a reading that shows every shutter back.
// -----------------------------------------------------------------------------

// Node categories of the shutters in `/home/nodes`: `shutter` for the
// io-homecontrol ones (position feedback), `basic_shutter` for the others.
export const SHUTTER_CATEGORIES = ['shutter', 'basic_shutter'];

// Two readings of the watch loop (30 s apart): a shutter the box lost for a
// few seconds is not worth a scene.
export const CONFIRM_ROUNDS = 2;

// Moves that did not happen, in a row, before an alarm. One move that does
// reset the count.
export const MISSED_MOVES = 2;

export const CAUSES = {
  DEVICES_UNREACHABLE: 'devices_unreachable',
  HOME_NOT_RESPONDING: 'home_not_responding',
  COMMAND_FAILED: 'command_failed',
  SHUTTER_NOT_MOVING: 'shutter_not_moving',
};

/**
 * Create the health tracker.
 * @param {object} [options] - Options.
 * @param {number} [options.confirmRounds] - Readings in a row before an alarm.
 * @param {number} [options.missedMoves] - Missed moves in a row before an alarm.
 * @param {Function} [options.now] - `() => number`, in ms.
 * @returns {object} The tracker: update, commandResult, moveResult, current, reset.
 * @example
 * const health = createHomeHealth();
 * const event = health.update({ nodes }); // { event: 'unreachable', ... } or null
 */
export function createHomeHealth({
  confirmRounds = CONFIRM_ROUNDS,
  missedMoves = MISSED_MOVES,
  now = () => Date.now(),
} = {}) {
  let shuttersSeen = false;
  let pending = 0;
  let missed = 0;
  // `{ cause, name }` of the last command that did not work, or null.
  let commandFailure = null;
  let episode = null;

  /**
   * The problem a reading shows, or null.
   * @param {{ nodes?: Array<object>, error?: string }} reading - The reading.
   * @returns {{ cause: string, names: string[] }|null} The problem.
   */
  function problemOf(reading) {
    if (reading.error) {
      return shuttersSeen ? { cause: CAUSES.HOME_NOT_RESPONDING, names: [] } : null;
    }
    const shutters = reading.nodes.filter((node) => SHUTTER_CATEGORIES.includes(node.category));
    if (shutters.length > 0) {
      shuttersSeen = true;
    }
    const lost = shutters.filter((node) => node.status === 'unreachable');
    return lost.length > 0
      ? { cause: CAUSES.DEVICES_UNREACHABLE, names: lost.map((node) => node.name) }
      : null;
  }

  /**
   * Open the episode and build its event.
   * @param {{ cause: string, names: string[] }} problem - The problem.
   * @returns {object} The `unreachable` event.
   */
  function open(problem) {
    episode = { ...problem, since: now() };
    return { event: 'unreachable', cause: problem.cause, names: problem.names };
  }

  /**
   * Close the episode and build its event.
   * @returns {object} The `reachable` event.
   */
  function close() {
    const minutes = Math.round((now() - episode.since) / 60000);
    const { cause } = episode;
    episode = null;
    return { event: 'reachable', cause, names: [], minutes };
  }

  return {
    /**
     * One reading of the watch loop.
     * @param {{ nodes?: Array<object>, error?: string }|null} reading - The home
     * nodes read from the box, the error of a home API that did not answer while
     * the rest of the box did, or null when nothing could be read.
     * @returns {object|null} The event to fire, or null.
     */
    update(reading) {
      if (!reading) {
        return null;
      }
      const problem = problemOf(reading);
      if (problem) {
        pending += 1;
      } else {
        pending = 0;
      }
      if (episode) {
        return problem || commandFailure ? null : close();
      }
      if (problem && pending >= confirmRounds) {
        return open(problem);
      }
      // A failed command is already the result of several attempts: no wait.
      if (commandFailure) {
        return open({ cause: commandFailure.cause, names: [commandFailure.name] });
      }
      return null;
    },

    /**
     * Outcome of a shutter command. A failure keeps the episode open until a
     * command goes through again. Only report a success for a command whose
     * effect cannot be checked (moveResult does it otherwise): an accepted
     * command proves nothing on a box that accepts them all.
     * @param {boolean} ok - Whether the box accepted the command.
     * @param {string} name - The shutter name.
     */
    commandResult(ok, name) {
      if (ok) {
        missed = 0;
        commandFailure = null;
      } else {
        commandFailure = { cause: CAUSES.COMMAND_FAILED, name };
      }
    },

    /**
     * Whether a shutter reached the position of its last command.
     * @param {boolean} ok - Reached.
     * @param {string} name - The shutter name.
     */
    moveResult(ok, name) {
      if (ok) {
        missed = 0;
        commandFailure = null;
        return;
      }
      missed += 1;
      if (missed >= missedMoves) {
        commandFailure = { cause: CAUSES.SHUTTER_NOT_MOVING, name };
      }
    },

    /** @returns {object|null} The open episode (`cause`, `names`, `since`). */
    current() {
      return episode;
    },

    /** Forget everything (unpairing). */
    reset() {
      shuttersSeen = false;
      pending = 0;
      missed = 0;
      commandFailure = null;
      episode = null;
    },
  };
}
