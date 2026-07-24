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

export class FreeboxClient {
  constructor() {
    // Resolved by discover(): e.g. "https://mafreebox.freebox.fr/api/v8".
    this.baseApiUrl = null;
    // Current session token, refreshed lazily / on expiry.
    this.sessionToken = null;
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
  async waitForAuthorization(trackId, { timeoutMs = 55000 } = {}) {
    await this.ensureDiscovered();
    const deadline = Date.now() + timeoutMs;

    // Poll every 2 seconds, like the Freebox recommends.
    for (;;) {
      const { data } = await freeboxRequest({
        url: `${this.baseApiUrl}/login/authorize/${trackId}`,
      });
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
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      // 'timeout' | 'denied' | 'unknown'
      throw new Error(`Freebox pairing failed with status "${status}"`);
    }
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

    let response = await run();
    if (isTokenExpired(response)) {
      // Session expired: refresh and retry once.
      await this.openSession(appToken);
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
    const tiles = (data && data.result) || [];

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
   * Read the current values of a single node (used for polling).
   * @param {string} appToken - The stored app token.
   * @param {number|string} nodeId - The Freebox node id.
   * @returns {Promise<object[]>} The `data` array of the node tile.
   * @example
   * const data = await client.loadNodeValues(appToken, 12);
   */
  async loadNodeValues(appToken, nodeId) {
    const { data } = await this.authRequest(appToken, { path: `/home/tileset/${nodeId}` });
    const tile = data && data.result && data.result[0];
    return (tile && tile.data) || [];
  }

  /**
   * Write a value to a device endpoint.
   * @param {string} appToken - The stored app token.
   * @param {number|string} nodeId - The Freebox node id.
   * @param {number|string} endpointId - The endpoint id.
   * @param {number|null} value - The value to write.
   * @returns {Promise<void>} Resolves when written.
   * @example
   * await client.setEndpointValue(appToken, 12, 1, 1);
   */
  async setEndpointValue(appToken, nodeId, endpointId, value) {
    await this.authRequest(appToken, {
      method: 'PUT',
      path: `/home/endpoints/${nodeId}/${endpointId}`,
      data: { value },
    });
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
    const allPlayers = (data && data.result) || [];

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
      throw new Error(`Freebox reboot refused: ${data.msg || 'unknown error'}`);
    }
  }

  /** Reset the in-memory session (e.g. on unpair). */
  reset() {
    this.sessionToken = null;
  }
}

export { PLAYER };
