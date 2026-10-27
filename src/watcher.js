// -----------------------------------------------------------------------------
// The watch loop: every WATCH_INTERVAL_MS, the LAN hosts, the call log and
// the state of the home nodes.
//
// These two lists feed scene triggers (a host connects or leaves, a call
// enters the log) and two widgets, so they are read on the integration's own
// timer rather than by the device polls of the core: the widgets then cost no
// request to the box, and a trigger fires whether or not a device exists in
// Gladys. A round never overlaps another one; each list keeps its previous
// snapshot when its reading fails, and the call log missing its permission
// (`insufficient_rights`) is remembered so the widget can say so.
//
// The home nodes feed the health of the home automation (src/homeHealth.js):
// they are only read when the box answered the hosts, so that a home API
// error means "the home system is silent", not "the box is rebooting".
// -----------------------------------------------------------------------------

import { readHosts, readCalls, readHomeNodes } from './freebox/read.js';
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
 * transitions of the round: `{ presence, calls, hostsChanged, callsChanged,
 * home }`, `home` being `{ nodes }`, `{ error }` or null (see homeHealth.js).
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
  let homeError = null;
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

    let boxAnswered = false;
    try {
      hosts = readHosts(await client.loadLanHosts(appToken));
      hostsAt = now();
      boxAnswered = true;
    } catch (e) {
      logger.warn(`Freebox: unable to read the LAN hosts: ${e.message}`);
    }

    const home = boxAnswered ? await readHome(appToken) : null;

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
      home,
    });
  }

  /**
   * Read the home nodes.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<{ nodes: Array<object> }|{ error: string }|null>} The
   * nodes, the error of a home API that did not answer, or null when the app
   * lacks the "home" permission (nothing to watch then).
   */
  async function readHome(appToken) {
    try {
      const nodes = readHomeNodes(await client.loadHomeNodes(appToken));
      homeError = null;
      return { nodes };
    } catch (e) {
      const code = e.code || 'error';
      // Logged once per cause: a box with no home system would otherwise fill
      // the logs twice a minute.
      if (code !== homeError) {
        logger.warn(`Freebox: unable to read the home nodes: ${e.message}`);
      }
      homeError = code;
      return code === 'insufficient_rights' ? null : { error: e.message };
    }
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
      homeError = null;
    },
    snapshot() {
      return { hosts, hostsAt, calls, callsAt, callsError };
    },
  };
}
