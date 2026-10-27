import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FreeboxClient, TILESET_SHARE_MS } from '../src/freebox/FreeboxClient.js';

/**
 * Build a client whose authenticated requests always answer the given payload,
 * so the response-parsing logic can be exercised without any network.
 * @param {any} data - The payload `authRequest` should resolve with.
 * @returns {FreeboxClient} A stubbed client.
 * @example
 * const client = clientAnswering({ success: true, result: {} });
 */
function clientAnswering(data) {
  const client = new FreeboxClient();
  client.authRequest = async () => ({ status: 200, data });
  return client;
}

// A Freebox without any home module answers `/home/tileset/all` with an object
// (or null) instead of the documented list — it must not crash the discovery.
const NON_LIST_RESULTS = [{}, null, undefined, { errors: [] }, 'nope'];

test('loadDevices returns an empty list when result is not an array', async () => {
  for (const result of NON_LIST_RESULTS) {
    const client = clientAnswering({ success: true, result });
    const devices = await client.loadDevices('token');
    assert.deepEqual(devices, [], `result=${JSON.stringify(result)}`);
  }
});

test('loadDevices groups tiles by node id', async () => {
  const client = clientAnswering({
    success: true,
    result: [
      { node_id: 12, label: 'Capteur' },
      { node_id: 12, label: 'Capteur (bis)' },
      { node_id: 13, label: 'Volet' },
    ],
  });

  const devices = await client.loadDevices('token');
  assert.equal(devices.length, 2);
  assert.equal(devices[0].node_id, 12);
  assert.equal(devices[0].specifications.length, 2);
  assert.equal(devices[1].node_id, 13);
  assert.equal(devices[1].specifications.length, 1);
});

test('loadNodeValues returns an empty list when result is not an array', async () => {
  for (const result of NON_LIST_RESULTS) {
    const client = clientAnswering({ success: true, result });
    const values = await client.loadNodeValues('token', 12);
    assert.deepEqual(values, [], `result=${JSON.stringify(result)}`);
  }
});

test('loadNodeValues returns an empty list when the tile carries no data', async () => {
  const client = clientAnswering({ success: true, result: [{ node_id: 12, data: null }] });
  const values = await client.loadNodeValues('token', 12);
  assert.deepEqual(values, []);
});

test('loadNodeValues returns the data of the tile', async () => {
  const client = clientAnswering({
    success: true,
    result: [{ node_id: 12, data: [{ ep_id: 1, value: 42 }] }],
  });
  const values = await client.loadNodeValues('token', 12);
  assert.deepEqual(values, [{ ep_id: 1, value: 42 }]);
});

// A node can expose several tiles, each carrying part of the endpoints:
// reading only the first one silently drops the other values.
test('loadNodeValues merges the endpoints of every tile of the node', async () => {
  const client = clientAnswering({
    success: true,
    result: [
      { node_id: 12, data: [{ ep_id: 1, value: 42 }] },
      { node_id: 12, data: [{ ep_id: 3, value: 85 }] },
      { node_id: 12, data: null },
    ],
  });
  const values = await client.loadNodeValues('token', 12);
  assert.deepEqual(values, [
    { ep_id: 1, value: 42 },
    { ep_id: 3, value: 85 },
  ]);
});

test('loadPlayers returns an empty list when result is not an array', async () => {
  for (const result of NON_LIST_RESULTS) {
    const client = clientAnswering({ success: true, result });
    const players = await client.loadPlayers('token');
    assert.deepEqual(players, [], `result=${JSON.stringify(result)}`);
  }
});

test('loadPlayers keeps only the players exposing the local control API', async () => {
  const client = clientAnswering({
    success: true,
    result: [
      { id: 1, device_name: 'Player', device_model: 'stb_v7', api_available: true },
      { id: 2, device_name: 'Player POP', device_model: 'stb_v8', api_available: false },
    ],
  });

  const players = await client.loadPlayers('token');
  assert.equal(players.length, 1);
  assert.equal(players[0].id, 1);
});

test('openSession shares one login between concurrent callers', async () => {
  const client = new FreeboxClient();
  let logins = 0;
  client.loginWithChallenge = async () => {
    logins += 1;
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    client.sessionToken = `session-${logins}`;
    return client.sessionToken;
  };

  const tokens = await Promise.all([
    client.openSession('app'),
    client.openSession('app'),
    client.openSession('app'),
  ]);
  assert.equal(logins, 1);
  assert.deepEqual(tokens, ['session-1', 'session-1', 'session-1']);

  // Once settled, a later call (an expired session) logs in again.
  await client.openSession('app');
  assert.equal(logins, 2);
});

test('openSession lets the next call retry after a failed login', async () => {
  const client = new FreeboxClient();
  let calls = 0;
  client.loginWithChallenge = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('box unreachable');
    }
    return 'session';
  };

  await assert.rejects(client.openSession('app'), /box unreachable/);
  assert.equal(await client.openSession('app'), 'session');
});

test('loadConnectionStatus returns the ConnectionStatus of the box', async () => {
  const result = { state: 'up', media: 'ftth', rate_down: 61, rate_up: 0 };
  const client = clientAnswering({ success: true, result });
  assert.deepEqual(await client.loadConnectionStatus('token'), result);
});

test('loadConnectionStatus fails loudly on a refused or empty answer', async () => {
  for (const data of [{ success: false, msg: 'nope' }, { success: true, result: null }, null]) {
    const client = clientAnswering(data);
    await assert.rejects(client.loadConnectionStatus('token'), /connection status unavailable/);
  }
});

test('the polls of one tick share a single /home/tileset/all reading', async () => {
  const client = new FreeboxClient();
  const paths = [];
  client.authRequest = async (appToken, { path }) => {
    paths.push(path);
    return {
      status: 200,
      data: {
        success: true,
        result: [
          { node_id: 12, data: [{ ep_id: 1, value: 42 }] },
          { node_id: 21, data: [{ ep_id: 3, value: 100 }] },
        ],
      },
    };
  };
  const [sensor, shutter] = await Promise.all([
    client.loadNodeValues('token', 12),
    client.loadNodeValues('token', '21'),
  ]);
  assert.deepEqual(sensor, [{ ep_id: 1, value: 42 }]);
  assert.deepEqual(shutter, [{ ep_id: 3, value: 100 }]);
  assert.deepEqual(await client.loadNodeValues('token', 99), []);
  assert.deepEqual(paths, ['/home/tileset/all']);
});

test('the shared reading expires before the next tick, and a failure is not kept', async () => {
  const client = new FreeboxClient();
  let calls = 0;
  let fail = true;
  client.authRequest = async () => {
    calls += 1;
    if (fail) {
      throw new Error('Freebox request timeout');
    }
    return { status: 200, data: { success: true, result: [] } };
  };
  let now = 1000;
  const clock = () => now;
  await assert.rejects(client.loadTileset('token', clock), /timeout/);
  fail = false;
  await client.loadTileset('token', clock);
  await client.loadTileset('token', clock);
  assert.equal(calls, 2);
  now += TILESET_SHARE_MS;
  await client.loadTileset('token', clock);
  assert.equal(calls, 3);
});
