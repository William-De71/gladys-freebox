// -----------------------------------------------------------------------------
// Did the shutter really move? (timers injected, tested alone)
//
// When the home system of a Freebox Delta loses its io-homecontrol shutters, it
// may say nothing: `/home/nodes` keeps them `active` and every command is
// accepted without an error, yet nothing moves (seen on 2026-11-02, the Free
// app could not move them either). The only symptom left is the position: it
// does not follow the commands any more.
//
// So after an open, close or position command, the position is read again once
// the shutter had the time to travel. Reached (within POSITION_TOLERANCE): the
// home automation works. Not reached: one missed move, homeHealth.js decides
// when misses in a row make an outage. A newer command on the same shutter
// (stop included) cancels the pending check, and a position the box cannot
// give (read error, no value) gives no verdict.
// -----------------------------------------------------------------------------

// Long enough for a large shutter to travel end to end, and for the box to
// report where it stopped.
export const CHECK_DELAY_MS = 90000;

// Positions are percentages; a shutter stopping a few points short of the end
// (or a box rounding) still moved.
export const POSITION_TOLERANCE = 5;

/**
 * Create the checker.
 * @param {object} options - Options.
 * @param {Function} options.readPosition - `(nodeId, endpointId) => Promise<number|null>`,
 * the position on the Freebox scale (0 = open, 100 = closed).
 * @param {Function} options.onResult - `({ ok, name, position, target }) => void|Promise<void>`.
 * @param {object} [options.logger] - Logger (debug, warn).
 * @param {number} [options.delayMs] - Wait before reading the position again.
 * @param {number} [options.tolerance] - Accepted gap with the target.
 * @param {Function} [options.setTimer] - `setTimeout`.
 * @param {Function} [options.clearTimer] - `clearTimeout`.
 * @returns {object} The checker: watch, cancel, stop.
 * @example
 * const check = createShutterCheck({ readPosition, onResult });
 * check.watch({ nodeId: '30', endpointId: '3', target: 100, name: 'Volet salon' });
 */
export function createShutterCheck({
  readPosition,
  onResult,
  logger = null,
  delayMs = CHECK_DELAY_MS,
  tolerance = POSITION_TOLERANCE,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const pending = new Map();

  /**
   * Read the position and report the verdict.
   * @param {{ nodeId: string, endpointId: string, target: number, name: string }} move - The move.
   * @returns {Promise<void>} Resolves once reported.
   */
  async function verify({ nodeId, endpointId, target, name }) {
    let position;
    try {
      position = await readPosition(nodeId, endpointId);
    } catch (e) {
      // The box did not answer: the watch loop judges the home API itself.
      if (logger) {
        logger.debug(`Freebox: position of "${name}" unreadable after a command: ${e.message}`);
      }
      return;
    }
    if (!Number.isFinite(position)) {
      return;
    }
    const ok = Math.abs(position - target) <= tolerance;
    try {
      await onResult({ ok, name, position, target });
    } catch (e) {
      if (logger) {
        logger.warn(`Freebox: shutter check of "${name}" failed: ${e.message}`);
      }
    }
  }

  return {
    /**
     * Check a move once the shutter had the time to travel.
     * @param {{ nodeId: string, endpointId: string, target: number, name: string }} move -
     * The node, its position endpoint, the position expected (Freebox scale)
     * and the shutter name.
     */
    watch(move) {
      this.cancel(move.nodeId);
      const timer = setTimer(() => {
        pending.delete(move.nodeId);
        verify(move);
      }, delayMs);
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
      pending.set(move.nodeId, timer);
    },

    /**
     * Forget the check of a shutter (a newer command was sent to it).
     * @param {string} nodeId - The node id.
     */
    cancel(nodeId) {
      if (pending.has(nodeId)) {
        clearTimer(pending.get(nodeId));
        pending.delete(nodeId);
      }
    },

    /** Forget every check (unpairing). */
    stop() {
      pending.forEach((timer) => clearTimer(timer));
      pending.clear();
    },
  };
}
