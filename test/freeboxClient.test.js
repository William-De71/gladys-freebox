import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FreeboxClient } from '../src/freebox/FreeboxClient.js';

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

test('loadNodeValues returns the data of the first tile', async () => {
  const client = clientAnswering({
    success: true,
    result: [{ node_id: 12, data: [{ ep_id: 1, value: 42 }] }],
  });
  const values = await client.loadNodeValues('token', 12);
  assert.deepEqual(values, [{ ep_id: 1, value: 42 }]);
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
