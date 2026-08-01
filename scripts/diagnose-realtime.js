// -----------------------------------------------------------------------------
// Diagnostic script: what can the Freebox tell us in real time?
//
// It answers two questions the documentation does not:
//   1. does the Freebox websocket expose home-automation events (an alarm
//      keyfob press), and under which `source` name?
//   2. can a fast poll catch the fugitive values the 30s integration poll
//      always misses (the keyfob `pushed` value is null on every tileset read)?
//
// Usage:
//   node scripts/diagnose-realtime.js --pair [nodeId...]
//   node scripts/diagnose-realtime.js <app_token> [nodeId...]
//
// `--pair` asks the Freebox for its own token: confirm on the LCD screen with
// the right arrow. It does NOT invalidate the token of the integration — the
// box remembers one grant per app_id, and this script declares its own. The
// token is printed so it can be reused on the next runs.
//
// Otherwise pass the token stored by the integration in the Gladys config
// (key `app_token`). Node ids default to the ones seen in the logs.
//
// Press the keyfob buttons while the script runs: it prints every frame the
// box sends, and polls the endpoints every 2 seconds in parallel.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import https from 'node:https';
import { freeboxRequest } from '../src/freebox/httpClient.js';
import { FREEBOX_LOCAL_URL, APP_IDENTITY, FREEBOX_ROOT_CA } from '../src/freebox/constants.js';

const [, , tokenOrFlag, ...nodeArgs] = process.argv;
const PAIRING_MODE = tokenOrFlag === '--pair';

if (!tokenOrFlag) {
  console.error('usage: node scripts/diagnose-realtime.js <app_token>|--pair [nodeId...]');
  process.exit(1);
}

// A distinct app_id, so pairing this script never overwrites the grant the
// integration already holds on the box. The Freebox caps the app_id length
// ("app_id is too long"), hence the short name rather than a suffixed one.
const DIAGNOSTIC_IDENTITY = {
  ...APP_IDENTITY,
  app_id: 'fr.freebox.gladysdiag',
  app_name: 'Gladys Freebox diagnostic',
};

// The keyfob (11) is the node we cannot read, and the opening sensor (18)
// gives a known-good comparison point. Watching fewer nodes keeps a poll round
// short. Pass node ids as arguments to watch others.
const NODE_IDS = nodeArgs.length > 0 ? nodeArgs : ['11', '18'];

// How long to listen before giving up, in ms.
const RUN_FOR_MS = 120000;
// How often to re-read the endpoint values, in ms. Much faster than the 30s
// integration poll: a fugitive value has a better chance of being caught.
const POLL_EVERY_MS = 2000;

const log = (...args) => console.log(new Date().toISOString().slice(11, 23), ...args);

/**
 * Discover the API base URL of the Freebox.
 * @returns {Promise<string>} e.g. "https://mafreebox.freebox.fr/api/v8".
 */
async function discover() {
  const { data } = await freeboxRequest({ url: `${FREEBOX_LOCAL_URL}/api_version` });
  if (!data || !data.api_base_url || !data.api_version) {
    throw new Error(`Freebox not found on ${FREEBOX_LOCAL_URL}`);
  }
  const [major] = `${data.api_version}`.split('.');
  log(`Freebox found: API v${data.api_version}, box "${data.box_model_name || '?'}"`);
  return `${FREEBOX_LOCAL_URL}${data.api_base_url}v${major}`;
}

/**
 * Ask the Freebox for an app token and wait for the physical confirmation on
 * the LCD screen.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @returns {Promise<string>} The freshly granted app token.
 */
async function pair(baseApiUrl) {
  const { data } = await freeboxRequest({
    method: 'POST',
    url: `${baseApiUrl}/login/authorize/`,
    data: DIAGNOSTIC_IDENTITY,
  });
  if (!data?.success || !data?.result?.app_token) {
    throw new Error(`the Freebox refused the authorization request: ${data?.msg || '?'}`);
  }
  const { app_token: token, track_id: trackId } = data.result;

  console.log('');
  log('>>> GO TO THE FREEBOX AND PRESS THE RIGHT ARROW ON ITS LCD SCREEN <<<');
  console.log('');

  const deadline = Date.now() + 60000;
  for (;;) {
    const progress = await freeboxRequest({ url: `${baseApiUrl}/login/authorize/${trackId}` });
    const status = progress.data?.result?.status;
    if (status === 'granted') {
      log('pairing granted');
      console.log('');
      log(`app_token (reuse it to skip the pairing next time):\n\n${token}\n`);
      return token;
    }
    if (status !== 'pending') {
      throw new Error(`pairing failed with status "${status}"`);
    }
    if (Date.now() > deadline) {
      throw new Error('pairing timed out: the LCD screen was not confirmed');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/**
 * Try to open a session with one identity.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @param {string} token - The app token to authenticate with.
 * @param {string} appId - The app_id the token was granted to.
 * @returns {Promise<{ sessionToken?: string, error?: string }>} The outcome.
 */
async function trySession(baseApiUrl, token, appId) {
  const challengeResponse = await freeboxRequest({ url: `${baseApiUrl}/login/` });
  const challenge = challengeResponse.data?.result?.challenge;
  if (!challenge) {
    throw new Error('no login challenge returned');
  }
  const password = crypto.createHmac('sha1', token).update(challenge).digest('hex');
  const { data } = await freeboxRequest({
    method: 'POST',
    url: `${baseApiUrl}/login/session/`,
    data: { app_id: appId, password },
  });
  if (data?.success && data?.result?.session_token) {
    return { sessionToken: data.result.session_token };
  }
  return { error: data?.msg || 'unknown error' };
}

/**
 * Open an authenticated session, trying both identities.
 *
 * A token pasted on the command line comes either from the integration
 * (app_id `fr.freebox.gladysassistant`) or from a previous `--pair` run
 * (`fr.freebox.gladysdiag`). The token alone does not say which, and the box
 * rejects the mismatch, so try both rather than guess.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @param {string} token - The app token to authenticate with.
 * @param {string} [knownAppId] - The app_id, when it is known for sure.
 * @returns {Promise<string>} The session token.
 */
async function openSession(baseApiUrl, token, knownAppId) {
  const candidates = knownAppId ? [knownAppId] : [APP_IDENTITY.app_id, DIAGNOSTIC_IDENTITY.app_id];

  const failures = [];
  for (const appId of candidates) {
    const { sessionToken, error } = await trySession(baseApiUrl, token, appId);
    if (sessionToken) {
      log(`session opened (app_id=${appId})`);
      return sessionToken;
    }
    failures.push(`${appId}: ${error}`);
  }

  throw new Error(
    `session refused for every identity tried —\n  ${failures.join('\n  ')}\n` +
      `If this token comes from the integration, make sure it is the full value of ` +
      `the "app_token" config key. Otherwise just run again with --pair.`,
  );
}

/**
 * Perform an authenticated API call.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @param {string} sessionToken - The current session token.
 * @param {object} options - Request options ({ path, method, data }).
 * @returns {Promise<{ status: number, data: any }>} The response.
 */
function authRequest(baseApiUrl, sessionToken, { path, method = 'GET', data, timeout }) {
  return freeboxRequest({
    url: `${baseApiUrl}${path}`,
    method,
    data,
    timeout,
    headers: { 'X-Fbx-App-Auth': sessionToken },
  });
}

// --- 1. Websocket ------------------------------------------------------------

// Candidate event sources. The documentation only ever shows LAN examples, so
// these are guesses built from the API namespaces; the box answers with a
// success flag per registration, which is exactly what we want to observe.
const CANDIDATE_EVENTS = [
  'home_node',
  'home_nodes',
  'home_endpoint',
  'home_endpoints',
  'home_adapter',
  'home_tileset',
  'home',
  'alarm',
  'alarm_state',
  'secmod',
  'notif',
  // The only documented example is a LAN one: keep it as a control, to prove
  // the probe does report a supported name rather than always failing.
  'lan_host_l3addr_reachable',
];

/**
 * Encode a text frame the way a websocket CLIENT must: masked, per RFC 6455.
 * @param {string} text - The payload to send.
 * @returns {Buffer} The frame.
 */
function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) {
    masked[i] ^= mask[i % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

/**
 * Decode the text frames of a server buffer (server frames are never masked).
 * @param {Buffer} buffer - Accumulated bytes.
 * @returns {{ messages: string[], rest: Buffer, closed: boolean }} Decoded frames.
 */
function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  let closed = false;
  for (;;) {
    if (offset + 2 > buffer.length) {
      break;
    }
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    if (offset + headerLength + length > buffer.length) {
      break;
    }
    const payload = buffer.subarray(offset + headerLength, offset + headerLength + length);
    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    } else if (opcode === 0x8) {
      closed = true;
    }
    offset += headerLength + length;
  }
  return { messages, rest: buffer.subarray(offset), closed };
}

/**
 * Open the Freebox websocket, register to every candidate event and print
 * every frame received.
 *
 * The handshake is done by hand on top of `https`: the Freebox authenticates
 * the websocket with the `X-Fbx-App-Auth` header (a `login` action over the
 * socket is answered with `auth_required`, then the box closes), and the
 * global WebSocket of Node cannot send custom headers.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @param {string} sessionToken - The current session token.
 * @returns {Promise<void>} Resolves when the socket closes.
 */
function listenWebsocket(baseApiUrl, sessionToken, events, { runForMs, quiet = false } = {}) {
  const wsUrl = `${baseApiUrl}/ws/event`;
  if (!quiet) {
    log(`websocket: connecting to ${wsUrl} (X-Fbx-App-Auth header)`);
  }

  return new Promise((resolve) => {
    const request = https.request(wsUrl, {
      ca: FREEBOX_ROOT_CA,
      rejectUnauthorized: false,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'X-Fbx-App-Auth': sessionToken,
      },
    });

    let finished = false;
    const outcome = { accepted: [], rejected: [], notifications: 0 };
    const finish = () => {
      if (!finished) {
        finished = true;
        resolve(outcome);
      }
    };

    request.on('upgrade', (response, socket) => {
      if (!quiet) {
        log(`websocket: OPEN (HTTP ${response.statusCode})`);
      }

      // The box CLOSES the socket on the first unsupported event name, so a
      // batch of candidates would only ever test its first entry.
      socket.write(encodeTextFrame(JSON.stringify({ action: 'register', request_id: 1, events })));

      let pending = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        const { messages, rest, closed } = decodeFrames(pending);
        pending = rest;
        messages.forEach((raw) => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            log(`websocket <- (non-JSON) ${raw.slice(0, 400)}`);
            return;
          }
          // A registration answer carries back the request_id we sent;
          // anything else is a real notification.
          if (parsed.request_id !== undefined) {
            if (parsed.success) {
              outcome.accepted.push(...events);
            } else {
              outcome.rejected.push({ events, msg: parsed.msg, code: parsed.error_code });
            }
            if (!quiet) {
              log(
                `websocket <- register [${events.join(', ')}]: success=${parsed.success}` +
                  `${parsed.error_code ? ` error_code=${parsed.error_code} msg=${parsed.msg || ''}` : ''}`,
              );
            }
            return;
          }
          outcome.notifications += 1;
          log(`websocket <- NOTIFICATION ${JSON.stringify(parsed)}`);
        });
        if (closed) {
          if (!quiet) {
            log('websocket: server sent a close frame');
          }
          socket.destroy();
        }
      });

      socket.on('close', () => {
        if (!quiet) {
          log('websocket: CLOSED');
        }
        finish();
      });
      socket.on('error', (e) => {
        log(`websocket: socket error ${e.message}`);
        finish();
      });

      setTimeout(() => socket.destroy(), runForMs ?? RUN_FOR_MS);
    });

    request.on('response', (response) => {
      // No upgrade: the box refused the handshake outright.
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        log(`websocket: handshake REFUSED, HTTP ${response.statusCode} ${body.slice(0, 300)}`);
        finish();
      });
    });

    request.on('error', (e) => {
      log(`websocket: cannot connect: ${e.message}`);
      finish();
    });

    request.end();
  });
}

/**
 * Probe every candidate event name, one connection each, and return the ones
 * the box accepts. A rejected name closes the socket, so they cannot share one.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @param {string} sessionToken - The current session token.
 * @returns {Promise<string[]>} The supported event names.
 */
async function probeEvents(baseApiUrl, sessionToken) {
  log(`probing ${CANDIDATE_EVENTS.length} candidate event name(s), one socket each...`);
  const supported = [];
  for (const candidate of CANDIDATE_EVENTS) {
    // 1.5s is plenty: the box answers the registration in a few ms.
    const outcome = await listenWebsocket(baseApiUrl, sessionToken, [candidate], {
      runForMs: 1500,
      quiet: true,
    });
    if (outcome.accepted.length > 0) {
      log(`  "${candidate}": SUPPORTED`);
      supported.push(candidate);
    } else {
      const reason = outcome.rejected[0];
      log(`  "${candidate}": rejected${reason?.msg ? ` (${reason.msg})` : ''}`);
    }
  }
  return supported;
}

// --- 2. Endpoint polling -----------------------------------------------------

/**
 * List the endpoints of the watched nodes, through the tileset.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @param {string} sessionToken - The current session token.
 * @returns {Promise<Array<{ node: string, ep: number, name: string, label: string }>>} Endpoints.
 */
async function listEndpoints(baseApiUrl, sessionToken) {
  const endpoints = [];
  for (const node of NODE_IDS) {
    const { data } = await authRequest(baseApiUrl, sessionToken, {
      path: `/home/tileset/${node}`,
    });
    const tiles = Array.isArray(data?.result) ? data.result : [];
    tiles.forEach((tile) => {
      (tile.data || []).forEach((ep) => {
        endpoints.push({ node, ep: ep.ep_id, name: ep.name, label: ep.label });
      });
    });
  }
  log(`watching ${endpoints.length} endpoint(s) on node(s) ${NODE_IDS.join(', ')}`);
  return endpoints;
}

/**
 * Read the watched endpoints and print the ones that changed since the
 * previous round.
 * @param {string} baseApiUrl - The versioned API base URL.
 * @param {string} sessionToken - The current session token.
 * @param {Array} endpoints - The endpoints to read.
 * @param {Map} previous - Last seen value per endpoint key.
 * @returns {Promise<void>} Resolves when the round is done.
 */
async function pollEndpoints(baseApiUrl, sessionToken, endpoints, previous) {
  // `POST /home/endpoints/get` answers "unable to apply endpoint batch"
  // whatever body shape we try, and its payload is undocumented — read each
  // endpoint on its own instead, which is a documented and working call.
  //
  // SEQUENTIALLY: firing all of them at once saturates the keep-alive agent
  // and the box starts timing out. The whole round still fits well inside the
  // 2s interval.
  const reads = [];
  for (const meta of endpoints) {
    try {
      const { status, data } = await authRequest(baseApiUrl, sessionToken, {
        path: `/home/endpoints/${meta.node}/${meta.ep}`,
        // Short: a stalled endpoint must not eat the whole round.
        timeout: 3000,
      });
      reads.push({ meta, status, data });
    } catch (e) {
      // One slow endpoint must not abort the whole round.
      reads.push({ meta, status: 0, data: null, error: e.message });
    }
  }

  if (!previous.has('__introspected__')) {
    previous.set('__introspected__', true);
    const sample = reads[0];
    log(
      `GET /home/endpoints/{node}/{ep} -> HTTP ${sample?.status} ` +
        `success=${sample?.data?.success}` +
        `${sample?.data?.error_code ? ` error_code=${sample.data.error_code}` : ''}`,
    );
    log(`first answer: ${JSON.stringify(sample?.data?.result)?.slice(0, 400)}`);
    // Full inventory once, so a value that never changes is still visible.
    reads.forEach(({ meta, data, error }) => {
      log(
        `  node ${meta.node} ep${meta.ep} ${meta.name} "${meta.label}" = ` +
          `${error ? `ERROR ${error}` : JSON.stringify(data?.result?.value)}`,
      );
    });
    console.log('');
  }

  reads.forEach(({ meta, data }) => {
    const key = `${meta.node}:${meta.ep}`;
    const value = JSON.stringify(data?.result?.value);
    if (previous.get(key) !== value) {
      // Only changes matter: a keyfob press shows up as a transient value.
      if (previous.has(key)) {
        log(
          `CHANGE node ${meta.node} ep${meta.ep} (${meta.name} "${meta.label}") ` +
            `${previous.get(key)} -> ${value}`,
        );
      }
      previous.set(key, value);
    }
  });
}

// --- Main --------------------------------------------------------------------

async function main() {
  const baseApiUrl = await discover();

  // Right after pairing the identity is known; a token passed on the command
  // line could come from either app, so let openSession try both.
  const appToken = PAIRING_MODE ? await pair(baseApiUrl) : tokenOrFlag;
  const sessionToken = await openSession(
    baseApiUrl,
    appToken,
    PAIRING_MODE ? DIAGNOSTIC_IDENTITY.app_id : undefined,
  );

  const endpoints = await listEndpoints(baseApiUrl, sessionToken);

  // Phase 1: which event names does this box accept at all?
  console.log('');
  const supported = await probeEvents(baseApiUrl, sessionToken);
  console.log('');
  if (supported.length === 0) {
    log('RESULT: no candidate event name is supported — no real-time home events.');
  } else {
    log(`RESULT: supported event name(s): ${supported.join(', ')}`);
  }

  // Phase 2: listen on whatever was accepted, while polling in parallel.
  const previous = new Map();
  console.log('');
  log('=== PRESS THE KEYFOB BUTTONS NOW (and open/close a sensor) ===');
  log(`listening for ${RUN_FOR_MS / 1000}s, polling every ${POLL_EVERY_MS / 1000}s`);
  console.log('');

  // A round is sequential, so it can outlast the interval: skip a tick rather
  // than pile up rounds and choke the box.
  let polling = false;
  const poller = setInterval(() => {
    if (polling) {
      return;
    }
    polling = true;
    pollEndpoints(baseApiUrl, sessionToken, endpoints, previous)
      .catch((e) => log(`poll error: ${e.message}`))
      .finally(() => {
        polling = false;
      });
  }, POLL_EVERY_MS);

  await pollEndpoints(baseApiUrl, sessionToken, endpoints, previous);

  if (supported.length > 0) {
    await listenWebsocket(baseApiUrl, sessionToken, supported);
  } else {
    // Nothing to subscribe to: keep polling for the same duration, so a
    // fugitive value still has its chance.
    log('websocket: nothing to subscribe to, polling only');
    await new Promise((resolve) => setTimeout(resolve, RUN_FOR_MS));
  }

  clearInterval(poller);
  log('done');
  process.exit(0);
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  console.error(e);
  process.exit(1);
});
