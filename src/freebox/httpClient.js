// -----------------------------------------------------------------------------
// Low-level HTTP client for the Freebox local API.
//
// The Freebox serves its API over HTTPS with a self-signed certificate chained
// to the Freebox Root CA (see constants.js). We use the native `https` module
// with a dedicated agent that trusts that CA, so no extra HTTP dependency is
// pulled in.
// -----------------------------------------------------------------------------

import https from 'node:https';
import { FREEBOX_ROOT_CA } from './constants.js';

// Reuse a single agent across requests: keep-alive + the Freebox Root CA.
// `rejectUnauthorized: false` mirrors the original integration: the Freebox
// certificate is issued for `*.fbxos.fr`, not for `mafreebox.freebox.fr`, so
// the hostname check would fail even though the CA is trusted.
const agent = new https.Agent({
  ca: FREEBOX_ROOT_CA,
  rejectUnauthorized: false,
  keepAlive: true,
});

/**
 * Perform an HTTPS request to the Freebox and parse the JSON response.
 * @param {object} options - Request options.
 * @param {string} options.url - Absolute URL to request.
 * @param {string} [options.method] - HTTP method (default GET).
 * @param {object} [options.headers] - Extra request headers.
 * @param {object|string} [options.data] - Request body (JSON-encoded if object).
 * @param {number} [options.timeout] - Request timeout in ms (default 10000).
 * @returns {Promise<{ status: number, data: any }>} Parsed response.
 * @example
 * await freeboxRequest({ url: 'https://mafreebox.freebox.fr/api/v8/login/' });
 */
export function freeboxRequest({ url, method = 'GET', headers = {}, data, timeout = 10000 }) {
  return new Promise((resolve, reject) => {
    let body;
    const finalHeaders = { ...headers };
    if (data !== undefined && data !== null) {
      body = typeof data === 'string' ? data : JSON.stringify(data);
      finalHeaders['Content-Type'] = 'application/json';
      finalHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const request = https.request(url, { method, headers: finalHeaders, agent, timeout }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (raw.length > 0) {
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
        }
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error(`Freebox request timeout after ${timeout}ms (${method} ${url})`));
    });

    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

/**
 * Whether a Freebox error response means the session token has expired.
 * @param {{ status: number, data: any }} response - Freebox response.
 * @returns {boolean} True when the token must be refreshed.
 * @example
 * isTokenExpired({ status: 403, data: { error_code: 'auth_required' } });
 */
export function isTokenExpired(response) {
  return response.status === 403 && response.data && response.data.error_code === 'auth_required';
}
