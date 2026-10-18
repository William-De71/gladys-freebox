// -----------------------------------------------------------------------------
// The watch loop: every WATCH_INTERVAL_MS, the LAN hosts and the call log.
//
// These two lists feed scene triggers (a host connects or leaves, a call
// enters the log) and two widgets, so they are read on the integration's own
// timer rather than by the device polls of the core: the widgets then cost no
// request to the box, and a trigger fires whether or not a device exists in
// Gladys. A round never overlaps another one; each list keeps its previous
// snapshot when its reading fails, and the call log missing its permission
// (`insufficient_rights`) is remembered so the widget can say so.
// -----------------------------------------------------------------------------

import { readHosts, readCalls } from './freebox/read.js';
import { diffPresence, newCalls, hostsSignature, callsSignature } from './tracker.js';

// Twice a minute: the box itself takes a few minutes to mark a host as gone,
// a shorter period would only cost requests.
export const WATCH_INTERVAL_MS = 30000;

/**
 * Create the watcher.
 * @param {object} options - Options.
 * @param {import('./freebox/FreeboxClient.js').FreeboxClient} options.client - Freebox client.
 * @param {Function} options.getAppToken - `async () => string|null`.
 * @param {Function} options.onRound - `async (round) => void`, with the
 * transitions of the round: `{ presence, calls, hostsChanged, callsChanged }`.
 * @param {object} options.logger - Logger.
 * @param {number} [options.intervalMs] - Period of the loop.
 * @param {Function} [options.now] - `() => number`, in ms.
 * @returns {object} The watcher: start, stop, runNow, snapshot.
 * @example
 * const watcher = createWatcher({ client, getAppToken, onRound, logger });
 * watcher.start();
 */
export function createWatcher({
  client,
  getAppToken,
  onRound,
  logger,
  intervalMs = WATCH_INTERVAL_MS,
  now = () => Date.now(),
}) {
  let hosts = null;
  let hostsAt = null;
  let calls = null;
  let callsAt = null;
  let callsError = null;
  let timer = null;
  let running = null;

  /**
   * One reading of both lists, then the transitions.
   * @returns {Promise<void>} Resolves when the round is over.
   */
  async function round() {
    const appToken = await getAppToken();
    if (!appToken) {
      return;
    }

    const previousHosts = hosts;
    const previousCalls = calls;

    try {
      hosts = readHosts(await client.loadLanHosts(appToken));
      hostsAt = now();
    } catch (e) {
      logger.warn(`Freebox: unable to read the LAN hosts: ${e.message}`);
    }

    try {
      calls = readCalls(await client.loadCallLog(appToken));
      callsAt = now();
      callsError = null;
    } catch (e) {
      const code = e.code || 'error';
      // Logged once per cause: an unticked permission would otherwise fill the
      // logs twice a minute.
      if (code !== callsError) {
        if (code === 'insufficient_rights') {
          logger.info(
            'Freebox call log not readable: tick the "Call log access" permission of ' +
              'Gladys Assistant in Freebox OS to get the calls widget and trigger.',
          );
        } else {
          logger.warn(`Freebox: unable to read the call log: ${e.message}`);
        }
      }
      callsError = code;
      // A permission removed: no list to compare the next one with.
      if (code === 'insufficient_rights') {
        calls = null;
      }
    }

    await onRound({
      presence: diffPresence(previousHosts, hosts),
      calls: newCalls(previousCalls, calls),
      hostsChanged:
        previousHosts !== null && hostsSignature(previousHosts) !== hostsSignature(hosts),
      callsChanged:
        previousCalls !== calls && callsSignature(previousCalls) !== callsSignature(calls),
    });
  }

  /**
   * Run a round now, or wait for the one in progress.
   * @returns {Promise<void>} Resolves when the round is over.
   */
  function runNow() {
    if (!running) {
      running = round()
        .catch((e) => logger.warn(`Freebox watch round failed: ${e.message}`))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  return {
    start() {
      if (timer) {
        return;
      }
      runNow();
      timer = setInterval(runNow, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runNow,
    /** Forget every list: the next round is a baseline again (unpairing). */
    reset() {
      hosts = null;
      hostsAt = null;
      calls = null;
      callsAt = null;
      callsError = null;
    },
    snapshot() {
      return { hosts, hostsAt, calls, callsAt, callsError };
    },
  };
}
