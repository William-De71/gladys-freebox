import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FreeboxClient } from '../src/freebox/FreeboxClient.js';

/**
 * Build a client whose authorization polls answer the given scripted results,
 * without touching the network. Each entry is either a status string or an
 * Error to throw for that poll.
 * @param {Array<string|Error>} script - One entry per expected poll.
 * @returns {{ client: FreeboxClient, polls: () => number }} Stubbed client.
 * @example
 * const { client } = pollingClient(['pending', 'granted']);
 */
function pollingClient(script) {
  const client = new FreeboxClient();
  // Skip the API-version discovery, which would hit the network.
  client.ensureDiscovered = async () => {};
  client.baseApiUrl = 'https://freebox.test/api/v8';

  let index = 0;
  client.pollAuthorization = async () => {
    const entry = script[Math.min(index, script.length - 1)];
    index += 1;
    if (entry instanceof Error) {
      throw entry;
    }
    return { data: { result: { status: entry } } };
  };
  return { client, polls: () => index };
}

test('waitForAuthorization resolves as soon as the user grants access', async () => {
  const { client } = pollingClient(['pending', 'granted']);
  await client.waitForAuthorization(1, { timeoutMs: 5000, pollIntervalMs: 1 });
});

test('waitForAuthorization rejects when the user denies access', async () => {
  const { client } = pollingClient(['denied']);
  await assert.rejects(
    () => client.waitForAuthorization(1, { timeoutMs: 5000, pollIntervalMs: 1 }),
    /denied/,
  );
});

test('waitForAuthorization times out while the user never confirms', async () => {
  const { client } = pollingClient(['pending']);
  await assert.rejects(
    () => client.waitForAuthorization(1, { timeoutMs: 30, pollIntervalMs: 1 }),
    /not confirmed on the LCD screen/,
  );
});

// Regression: a single slow or failing poll (request timeout, transient DNS
// error) used to abort the whole pairing, long before the timeout window had
// elapsed — the user was still walking to the box. Transient errors must be
// retried until the deadline.
test('waitForAuthorization survives transient poll failures', async () => {
  const { client, polls } = pollingClient([
    new Error('Freebox request timeout after 10000ms'),
    Object.assign(new Error('getaddrinfo EAI_AGAIN mafreebox.freebox.fr'), { code: 'EAI_AGAIN' }),
    'pending',
    'granted',
  ]);

  await client.waitForAuthorization(1, { timeoutMs: 5000, pollIntervalMs: 1 });
  assert.equal(polls(), 4, 'pairing should have kept polling through the failures');
});

test('waitForAuthorization reports the last error when failures outlast the deadline', async () => {
  const { client } = pollingClient([new Error('getaddrinfo EAI_AGAIN mafreebox.freebox.fr')]);
  await assert.rejects(
    () => client.waitForAuthorization(1, { timeoutMs: 30, pollIntervalMs: 1 }),
    /EAI_AGAIN/,
  );
});
