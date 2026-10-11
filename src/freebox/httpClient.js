// -----------------------------------------------------------------------------
// Low-level HTTP client for the Freebox local API.
//
// The Freebox serves its API over HTTPS with a certificate issued by Free's own
// root CAs (see constants.js). We use the native `https` module with a
// dedicated agent that trusts those CAs, so no extra HTTP dependency is pulled
// in.
// -----------------------------------------------------------------------------

import https from 'node:https';
import tls from 'node:tls';
import { FREEBOX_CA_CERTS } from './constants.js';

// Free's certificates name the box under its own domain (`xxxx.fbxos.fr`) and,
// on current firmwares, as `mafreebox.freebox.fr` too. Accept either: the
// chain itself must still lead to one of Free's root CAs, so a device on the
// LAN impersonating the Freebox with any other certificate is refused.
const FREEBOX_DOMAIN = /^[a-z0-9-]+\.fbxos\.fr$/i;

/**
 * Hostname check of the Freebox certificate: the standard one, relaxed to the
 * box's own `*.fbxos.fr` name.
 * @param {string} hostname - Host requested (`mafreebox.freebox.fr`).
 * @param {object} cert - Peer certificate, already verified against the CAs.
 * @returns {Error|undefined} An error when the certificate names another host.
 * @example
 * checkFreeboxIdentity('mafreebox.freebox.fr', socket.getPeerCertificate());
 */
export function checkFreeboxIdentity(hostname, cert) {
  const standard = tls.checkServerIdentity(hostname, cert);
  if (!standard) {
    return undefined;
  }
  const names = `${(cert && cert.subjectaltname) || ''}`
    .split(',')
    .map((entry) => entry.trim().replace(/^DNS:/, ''));
  if (cert && cert.subject && cert.subject.CN) {
    names.push(cert.subject.CN);
  }
  return names.some((name) => FREEBOX_DOMAIN.test(name)) ? undefined : standard;
}

// TLS options shared by every connection to the box (API and websocket).
export const FREEBOX_TLS_OPTIONS = {
  ca: FREEBOX_CA_CERTS,
  rejectUnauthorized: true,
  checkServerIdentity: checkFreeboxIdentity,
};

// Reuse a single agent across requests: keep-alive + Free's root CAs.
const agent = new https.Agent({ ...FREEBOX_TLS_OPTIONS, keepAlive: true });

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
