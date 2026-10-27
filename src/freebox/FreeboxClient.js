// -----------------------------------------------------------------------------
// FreeboxClient: everything that talks to the Freebox local API.
//
// Responsibilities:
//   - discover the Freebox on the LAN and resolve its versioned API base URL;
//   - pairing flow (request an app token, wait for the physical LCD grant);
//   - open an authenticated session (challenge + HMAC-SHA1 password);
//   - authenticated request helper with automatic session refresh + retry;
//   - load home-automation devices (tiles) and players.
//
// The client is stateless regarding persistence: the app token is provided by
// the caller (read from / written to the Gladys config), never stored here.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { freeboxRequest, isTokenExpired } from './httpClient.js';
import { FREEBOX_LOCAL_URL, APP_IDENTITY, PLAYER } from './constants.js';

const logger = createLogger({ name: 'freebox-client' });

// The core polls every home device on the same tick (all at 30 s): the polls of
// a tick share ONE `/home/tileset/all` reading instead of one request per
// node. The Freebox Delta home system is known to choke on the stream of
// shutter readings; fewer requests spare it. Well below the poll period, so
// the next tick always reads the box again.
export const TILESET_SHARE_MS = 5000;

/**
 * Normalize a Freebox `result` payload into an array. Depending on the box
 * state (no home module installed, empty collection...), the API answers with
 * an object or `null` where a list is documented, so callers must never assume
 * an array.
 * @param {any} result - The raw `result` field of a Freebox response.
 * @returns {any[]} The result as an array, empty when it is not a list.
 * @example
 * asArray({ result: [] }.result); // []
 */
function asArray(result) {
  return Array.isArray(result) ? result : [];
}

export class FreeboxClient {
  constructor() {
    // Resolved by discover(): e.g. "https://mafreebox.freebox.fr/api/v8".
    this.baseApiUrl = null;
    // Current session token, refreshed lazily / on expiry.
    this.sessionToken = null;
    // Session opening in flight, shared by concurrent callers (see openSession).
    this.sessionPromise = null;
    // `/home/tileset/all` reading shared by the polls of a tick (see loadTileset).
    this.tilesetPromise = null;
    this.tilesetAt = 0;
  }

  /**
   * Discover the Freebox on the local network and resolve the versioned API
   * base URL. Idempotent: safe to call before every operation.
   * @returns {Promise<object>} The Freebox api_version payload.
   * @example
   * await client.discover();
   */
  async discover() {
    const { status, data } = await freeboxRequest({ url: `${FREEBOX_LOCAL_URL}/api_version` });
    if (status !== 200 || !data || !data.api_base_url || !data.api_version) {
      throw new Error(`Freebox not found on the local network (check ${FREEBOX_LOCAL_URL})`);
    }
    const [apiVersionMajor] = `${data.api_version}`.split('.');
    this.baseApiUrl = `${FREEBOX_LOCAL_URL}${data.api_base_url}v${apiVersionMajor}`;
    logger.debug(`Freebox discovered, API base URL: ${this.baseApiUrl}`);
    return data;
  }

  /** Ensure discover() has run (baseApiUrl is set). */
  async ensureDiscovered() {
    if (!this.baseApiUrl) {
      await this.discover();
    }
  }

  /**
   * Start the pairing flow: ask the Freebox for an app token. The user must
   * then physically authorize the app on the Freebox LCD screen.
   * @returns {Promise<{ appToken: string, trackId: number }>} Pairing tokens.
   * @example
   * const { appToken, trackId } = await client.requestAuthorization();
   */
  async requestAuthorization() {
    await this.ensureDiscovered();
    const { data } = await freeboxRequest({
      method: 'POST',
      url: `${this.baseApiUrl}/login/authorize/`,
      data: APP_IDENTITY,
    });
    if (!data || !data.success || !data.result) {
      throw new Error('Freebox refused the authorization request');
    }
    return { appToken: data.result.app_token, trackId: data.result.track_id };
  }

  /**
   * Poll the pairing progress until the user grants (or denies) access on the
   * Freebox LCD screen.
   * @param {number} trackId - Track id returned by requestAuthorization().
   * @param {object} [options] - Options.
   * @param {number} [options.timeoutMs] - Give up after this delay (default 55s).
   * @returns {Promise<void>} Resolves when access is granted.
   * @example
   * await client.waitForAuthorization(42);
   */
  async waitForAuthorization(trackId, { timeoutMs = 55000, pollIntervalMs = 2000 } = {}) {
    await this.ensureDiscovered();
    const deadline = Date.now() + timeoutMs;

    // Poll every 2 seconds, like the Freebox recommends.
    for (;;) {
      // A single failed poll (request timeout, transient DNS or network error)
      // must not abort the pairing: the user may still be walking to the box.
      // Keep retrying until `deadline`, and only then report the failure.
      let data;
      try {
        ({ data } = await this.pollAuthorization(trackId));
      } catch (e) {
        if (Date.now() > deadline) {
          throw new Error(`Freebox pairing failed while polling the authorization: ${e.message}`, {
            cause: e,
          });
        }
        logger.warn(`Freebox authorization poll failed, retrying: ${e.message}`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      const status = data && data.result && data.result.status;

      if (status === 'granted') {
        logger.info('Freebox pairing granted');
        return;
      }
      if (status === 'pending') {
        if (Date.now() > deadline) {
          throw new Error(
            'Freebox pairing timed out: authorization was not confirmed on the LCD screen',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      // 'timeout' | 'denied' | 'unknown'
      throw new Error(`Freebox pairing failed with status "${status}"`);
    }
  }

  /**
   * Query the current pairing status once. Split out of waitForAuthorization()
   * so the polling loop can be exercised without any network.
   * @param {number} trackId - Track id returned by requestAuthorization().
   * @returns {Promise<{ status: number, data: any }>} The Freebox answer.
   * @example
   * const { data } = await client.pollAuthorization(42);
   */
  async pollAuthorization(trackId) {
    return freeboxRequest({ url: `${this.baseApiUrl}/login/authorize/${trackId}` });
  }

  /**
   * Open a session and return a fresh session token, from the stored app token.
   * Uses the Freebox challenge + HMAC-SHA1 authentication scheme.
   * @param {string} appToken - The app token obtained during pairing.
   * @returns {Promise<string>} The session token.
   * @example
   * const token = await client.openSession(appToken);
   */
  async openSession(appToken) {
    if (!appToken) {
      throw new Error('Freebox is not paired (no app token)');
    }
    // Gladys polls every device on the same tick: without this, each poll
    // would run its own challenge + login round trip, and the sessions opened
    // in parallel would replace one another. Concurrent callers share one.
    if (!this.sessionPromise) {
      this.sessionPromise = this.loginWithChallenge(appToken).finally(() => {
        this.sessionPromise = null;
      });
    }
    return this.sessionPromise;
  }

  /**
   * One login round trip: read the challenge, answer it, store the token.
   * Called through openSession(), which shares it between concurrent callers.
   * @param {string} appToken - The app token obtained during pairing.
   * @returns {Promise<string>} The session token.
   * @example
   * const token = await client.loginWithChallenge(appToken);
   */
  async loginWithChallenge(appToken) {
    await this.ensureDiscovered();

    // 1) Get the current challenge.
    const challengeResponse = await freeboxRequest({ url: `${this.baseApiUrl}/login/` });
    const challenge =
      challengeResponse.data &&
      challengeResponse.data.result &&
      challengeResponse.data.result.challenge;
    if (!challenge) {
      throw new Error('Freebox did not return a login challenge');
    }

    // 2) Build the password (HMAC-SHA1 of the challenge, keyed with the app token).
    const password = crypto.createHmac('sha1', appToken).update(challenge).digest('hex');

    // 3) Open the session.
    const sessionResponse = await freeboxRequest({
      method: 'POST',
      url: `${this.baseApiUrl}/login/session/`,
      data: { app_id: APP_IDENTITY.app_id, password },
    });

    const result = sessionResponse.data && sessionResponse.data.result;
    if (
      !sessionResponse.data ||
      !sessionResponse.data.success ||
      !result ||
      !result.session_token
    ) {
      const msg = (sessionResponse.data && sessionResponse.data.msg) || 'unknown error';
      throw new Error(`Freebox session could not be opened: ${msg}`);
    }

    this.sessionToken = result.session_token;
    return this.sessionToken;
  }

  /**
   * Perform an authenticated request. Opens a session if needed and, on an
   * expired token, refreshes it once and retries.
   * @param {string} appToken - The stored app token (for session refresh).
   * @param {object} options - Request options (relative `path`, method, data...).
   * @param {string} options.path - Path appended to the API base URL.
   * @param {string} [options.method] - HTTP method.
   * @param {object|string} [options.data] - Request body.
   * @returns {Promise<{ status: number, data: any }>} Freebox response.
   * @example
   * await client.authRequest(appToken, { path: '/home/tileset/all' });
   */
  async authRequest(appToken, options) {
    await this.ensureDiscovered();
    if (!this.sessionToken) {
      await this.openSession(appToken);
    }

    const run = () =>
      freeboxRequest({
        ...options,
        url: `${this.baseApiUrl}${options.path}`,
        headers: { ...options.headers, 'X-Fbx-App-Auth': this.sessionToken },
      });

    const tokenUsed = this.sessionToken;
    let response = await run();
    if (isTokenExpired(response)) {
      // Session expired: refresh and retry once. A concurrent request may have
      // refreshed it already, in which case the new token is simply reused.
      if (this.sessionToken === tokenUsed) {
        await this.openSession(appToken);
      }
      response = await run();
    }
    return response;
  }

  /**
   * Load the home-automation devices, grouped by node id. The
   * `/home/tileset/all` response already carries the full tiles
   * (label, type, action, data...), so a single request is enough.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<Array<{ node_id: number, specifications: object[] }>>} Devices.
   * @example
   * const devices = await client.loadDevices(appToken);
   */
  async loadDevices(appToken) {
    const { data } = await this.authRequest(appToken, { path: '/home/tileset/all' });
    const tiles = asArray(data && data.result);

    const devicesByNodeId = {};
    tiles.forEach((tile) => {
      if (!devicesByNodeId[tile.node_id]) {
        devicesByNodeId[tile.node_id] = { node_id: tile.node_id, specifications: [] };
      }
      devicesByNodeId[tile.node_id].specifications.push(tile);
    });

    const devices = Object.values(devicesByNodeId);
    logger.debug(`${devices.length} Freebox home devices loaded`);
    return devices;
  }

  /**
   * Read every tile of the box, shared by the callers of the next
   * TILESET_SHARE_MS: the polls of one tick cost a single request. A failed
   * reading is not kept, the next caller tries again.
   * @param {string} appToken - The stored app token.
   * @param {Function} [now] - `() => number`, in ms.
   * @returns {Promise<object[]>} The tiles.
   * @example
   * const tiles = await client.loadTileset(appToken);
   */
  loadTileset(appToken, now = Date.now) {
    if (this.tilesetPromise && now() - this.tilesetAt < TILESET_SHARE_MS) {
      return this.tilesetPromise;
    }
    this.tilesetAt = now();
    const reading = this.authRequest(appToken, { path: '/home/tileset/all' }).then(
      ({ status, data }) => {
        // The shape of this answer is the thing to check first when no value
        // ever reaches the dashboard: a non-array `result`, an error payload or
        // an empty list all end up as "no recent value" downstream.
        logger.debug(
          `Freebox /home/tileset/all -> HTTP ${status} success=${data && data.success} ` +
            `result=${Array.isArray(data && data.result) ? `${data.result.length} tile(s)` : typeof (data && data.result)}` +
            `${data && data.error_code ? ` error_code=${data.error_code} msg=${data.msg}` : ''}`,
        );
        return asArray(data && data.result);
      },
    );
    this.tilesetPromise = reading;
    reading.catch(() => {
      if (this.tilesetPromise === reading) {
        this.tilesetPromise = null;
      }
    });
    return reading;
  }

  /**
   * Read the current values of a single node (used for polling), from the
   * reading shared by the polls of the tick (see loadTileset).
   * @param {string} appToken - The stored app token.
   * @param {number|string} nodeId - The Freebox node id.
   * @returns {Promise<object[]>} The `data` arrays of the node tiles, merged.
   * @example
   * const data = await client.loadNodeValues(appToken, 12);
   */
  async loadNodeValues(appToken, nodeId) {
    const tiles = (await this.loadTileset(appToken)).filter(
      (tile) => tile && String(tile.node_id) === String(nodeId),
    );
    logger.debug(`Freebox node ${nodeId}: ${JSON.stringify(tiles)}`);

    // No tile for a node the user created is not normal (removed from the box,
    // permission withdrawn): say it out loud.
    if (tiles.length === 0) {
      logger.warn(`Freebox /home/tileset/all carries no tile for node ${nodeId}`);
    }

    // A node can expose several tiles, each carrying part of the endpoints.
    // Reading only the first one would silently drop the values of the others.
    return tiles.flatMap((tile) => asArray(tile && tile.data));
  }

  /**
   * Write a value to a device endpoint.
   * @param {string} appToken - The stored app token.
   * @param {number|string} nodeId - The Freebox node id.
   * @param {number|string} endpointId - The endpoint id.
   * @param {number|null} value - The value to write.
   * @param {object} [options] - Options.
   * @param {number} [options.timeout] - Request timeout in ms, shorter than the
   * default for a command that has to fit in the 5 s acknowledgement.
   * @returns {Promise<void>} Resolves when written.
   * @example
   * await client.setEndpointValue(appToken, 12, 1, 1);
   */
  async setEndpointValue(appToken, nodeId, endpointId, value, { timeout } = {}) {
    const { status, data } = await this.authRequest(appToken, {
      method: 'PUT',
      path: `/home/endpoints/${nodeId}/${endpointId}`,
      data: { value },
      ...(timeout ? { timeout } : {}),
    });

    // The Freebox answers 200 with `success: false` when it refuses a write
    // (wrong value type on a `void` endpoint, read-only endpoint...). Staying
    // silent here makes a rejected command look like a successful one.
    if (data && data.success === false) {
      throw new Error(
        `Freebox refused the write on ${nodeId}/${endpointId}: ` +
          `${data.msg || 'unknown error'} (error_code=${data.error_code || '?'})`,
      );
    }
    logger.debug(`Freebox write ${nodeId}/${endpointId} accepted (HTTP ${status})`);
  }

  /**
   * Read the state of the internet connection (`ConnectionStatus`: `state`,
   * `media`, `rate_down`, `rate_up` in bytes per second...). Needs no
   * permission: reading the settings is open to every paired app.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<object>} The `result` of `/connection/`.
   * @see https://dev.freebox.fr/sdk/os/connection/
   * @example
   * const { state, rate_down: rateDown } = await client.loadConnectionStatus(appToken);
   */
  async loadConnectionStatus(appToken) {
    const { data } = await this.authRequest(appToken, { path: '/connection/' });
    if (!data || data.success === false || !data.result || typeof data.result !== 'object') {
      throw new Error(
        `Freebox connection status unavailable: ${(data && data.msg) || 'unexpected answer'}`,
      );
    }
    return data.result;
  }

  /**
   * Load the Freebox Players (set-top boxes). Requires the "player" permission
   * to be granted to the app in Freebox OS.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<object[]>} Players with `api_available: true`.
   * @example
   * const players = await client.loadPlayers(appToken);
   */
  async loadPlayers(appToken) {
    const { data } = await this.authRequest(appToken, { path: '/player' });
    const allPlayers = asArray(data && data.result);

    // Only players exposing the local player API can be controlled. On the
    // Freebox Player POP (Android TV, stb_v8), api_available is false: Free
    // does not expose the local /player/{id}/api control endpoints on that
    // model — it must be driven through Android TV protocols (ADB) instead,
    // which is out of scope for this integration.
    const players = allPlayers.filter((player) => player.api_available);

    const skipped = allPlayers.filter((player) => !player.api_available);
    skipped.forEach((player) => {
      logger.info(
        `Freebox player "${player.device_name}" (${player.device_model}) skipped: its local control API ` +
          `is not available (api_available=false). Android TV players like the Player POP are not controllable ` +
          `through the Freebox API; use an Android TV integration instead.`,
      );
    });

    logger.debug(`${players.length} controllable Freebox player(s) loaded`);
    return players;
  }

  /**
   * Perform an authenticated request against a Player sub-API.
   * @param {string} appToken - The stored app token.
   * @param {object} options - Request options (`path`, method, data...).
   * @returns {Promise<{ status: number, data: any }>} Freebox response.
   * @example
   * await client.playerRequest(appToken, { path: '/player/1/api/v6/status/' });
   */
  async playerRequest(appToken, options) {
    return this.authRequest(appToken, options);
  }

  /**
   * Reboot the Freebox Server. Requires the "settings" permission.
   * Note: the Freebox API only exposes a reboot, no shutdown (a powered-off
   * box could not be turned back on remotely).
   * @param {string} appToken - The stored app token.
   * @returns {Promise<void>} Resolves once the reboot has been requested.
   * @example
   * await client.reboot(appToken);
   */
  async reboot(appToken) {
    const { data } = await this.authRequest(appToken, {
      method: 'POST',
      path: '/system/reboot/',
    });
    if (data && data.success === false) {
      const error = new Error(`Freebox reboot refused: ${data.msg || 'unknown error'}`);
      // `insufficient_rights` when the settings permission is not ticked.
      error.code = data.error_code;
      throw error;
    }
  }

  /**
   * Run an authenticated request and return its `result`, or throw an error
   * carrying the Freebox `error_code` (`insufficient_rights` when the app
   * lacks a permission, which callers turn into a clear message).
   * @param {string} appToken - The stored app token.
   * @param {object} options - Request options (`path`, method, data...).
   * @param {string} what - What is read, for the error message.
   * @returns {Promise<any>} The `result` of the answer (null when absent).
   * @example
   * const system = await client.resultOf(appToken, { path: '/system/' }, 'system');
   */
  async resultOf(appToken, options, what) {
    const { status, data } = await this.authRequest(appToken, options);
    if (!data || typeof data !== 'object' || data.success !== true) {
      const code = (data && data.error_code) || `http_${status}`;
      const error = new Error(
        `Freebox ${what} unavailable: ${(data && data.msg) || 'unexpected answer'} (${code})`,
      );
      error.code = code;
      throw error;
    }
    return data.result === undefined ? null : data.result;
  }

  /**
   * Read the system state: firmware, uptime, temperature sensors and fans.
   * Readable by every paired app.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<object>} The `result` of `/system/`.
   * @see https://dev.freebox.fr/sdk/os/system/
   * @example
   * const system = await client.loadSystem(appToken);
   */
  async loadSystem(appToken) {
    return (await this.resultOf(appToken, { path: '/system/' }, 'system state')) || {};
  }

  /**
   * Read the Wi-Fi global configuration (`enabled`). Readable by every app.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<object>} The `result` of `/wifi/config/`.
   * @see https://dev.freebox.fr/sdk/os/wifi/
   * @example
   * const { enabled } = await client.loadWifiConfig(appToken);
   */
  async loadWifiConfig(appToken) {
    return (await this.resultOf(appToken, { path: '/wifi/config/' }, 'Wi-Fi state')) || {};
  }

  /**
   * Turn the Wi-Fi of the box on or off (every access point at once). Needs
   * the "settings" permission.
   * @param {string} appToken - The stored app token.
   * @param {boolean} enabled - The wanted state.
   * @returns {Promise<object>} The configuration the box applied.
   * @example
   * await client.setWifiEnabled(appToken, false);
   */
  async setWifiEnabled(appToken, enabled) {
    return (
      (await this.resultOf(
        appToken,
        { method: 'PUT', path: '/wifi/config/', data: { enabled: Boolean(enabled) } },
        'Wi-Fi switch',
      )) || {}
    );
  }

  /**
   * List the hosts the box knows on every browsable LAN interface (the
   * active ones and the ones seen before). Readable by every app.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<Array<object>>} The `LanHost` objects, each with the
   * `interface` it was listed on.
   * @see https://dev.freebox.fr/sdk/os/lan/
   * @example
   * const hosts = await client.loadLanHosts(appToken);
   */
  async loadLanHosts(appToken) {
    const interfaces = asArray(
      await this.resultOf(appToken, { path: '/lan/browser/interfaces/' }, 'LAN interfaces'),
    );
    const hosts = [];
    for (const { name } of interfaces) {
      if (!name) {
        continue;
      }
      const listed = asArray(
        await this.resultOf(
          appToken,
          { path: `/lan/browser/${encodeURIComponent(name)}/` },
          `LAN hosts of "${name}"`,
        ),
      );
      listed.forEach((host) => hosts.push({ ...host, interface: name }));
    }
    return hosts;
  }

  /**
   * Send a Wake-on-LAN packet from the box.
   * @param {string} appToken - The stored app token.
   * @param {string} mac - The MAC address of the host to wake.
   * @param {string} [lanInterface] - The LAN interface (`pub` by default).
   * @returns {Promise<void>} Resolves once the box sent the packet.
   * @example
   * await client.wakeOnLan(appToken, '00:24:D4:7E:00:4C');
   */
  async wakeOnLan(appToken, mac, lanInterface = 'pub') {
    await this.resultOf(
      appToken,
      {
        method: 'POST',
        path: `/lan/wol/${encodeURIComponent(lanInterface)}/`,
        data: { mac, password: '' },
      },
      'Wake-on-LAN',
    );
  }

  /**
   * Read the call log, most recent first. Needs the "calls" permission
   * (`insufficient_rights` otherwise).
   * @param {string} appToken - The stored app token.
   * @returns {Promise<Array<object>>} The `CallEntry` objects.
   * @see https://dev.freebox.fr/sdk/os/call/
   * @example
   * const calls = await client.loadCallLog(appToken);
   */
  async loadCallLog(appToken) {
    return asArray(await this.resultOf(appToken, { path: '/call/log/' }, 'call log'));
  }

  /**
   * Mark every call of the log as read. Needs the "calls" permission.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<void>} Resolves once done.
   * @example
   * await client.markCallsAsRead(appToken);
   */
  async markCallsAsRead(appToken) {
    await this.resultOf(
      appToken,
      { method: 'POST', path: '/call/log/mark_all_as_read/' },
      'call log',
    );
  }

  /**
   * Read the history of the internet rates kept by the box (`net` database
   * of the RRD API), in bytes per second. The POST form needs the "settings"
   * permission; the documentation allows the same request as a GET without
   * it, which is tried when the POST is refused.
   * @param {string} appToken - The stored app token.
   * @param {number} dateStart - Start of the period, in seconds since the epoch.
   * @param {number} [dateEnd] - End of the period, in seconds; now when absent.
   * @returns {Promise<Array<object>>} Points `{ time, rate_down, rate_up }`.
   * @see https://dev.freebox.fr/sdk/os/rrd/
   * @example
   * const points = await client.loadNetHistory(appToken, Math.floor(Date.now() / 1000) - 86400);
   */
  async loadNetHistory(appToken, dateStart, dateEnd) {
    const query = { db: 'net', fields: ['rate_down', 'rate_up'], date_start: dateStart };
    if (dateEnd !== undefined) {
      query.date_end = dateEnd;
    }
    let result;
    try {
      result = await this.resultOf(
        appToken,
        { method: 'POST', path: '/rrd/', data: query },
        'rate history',
      );
    } catch (e) {
      if (e.code !== 'insufficient_rights') {
        throw e;
      }
      result = await this.resultOf(
        appToken,
        { method: 'GET', path: '/rrd/', data: query },
        'rate history',
      );
    }
    return asArray(result && result.data);
  }

  /**
   * List the home nodes with their state (`status`: `active`, `unreachable`,
   * `disabled`, `unpaired`) and `category` (`shutter`, `basic_shutter`,
   * `alarm`, `pir`, `kfb`, `camera`...). Needs the "home" permission. The
   * state is not part of the tiles: this is the only place telling that the
   * box lost a device.
   * @param {string} appToken - The stored app token.
   * @returns {Promise<Array<object>>} The home nodes.
   * @example
   * const nodes = await client.loadHomeNodes(appToken);
   */
  async loadHomeNodes(appToken) {
    return asArray(await this.resultOf(appToken, { path: '/home/nodes' }, 'home nodes'));
  }

  /** Reset the in-memory session (e.g. on unpair). */
  reset() {
    this.sessionToken = null;
    this.sessionPromise = null;
    this.tilesetPromise = null;
    this.tilesetAt = 0;
  }
}

export { PLAYER };
