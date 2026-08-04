import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDeviceValue, pollDevice } from '../src/devices.js';
import { COVER_STATE } from '../src/freebox/deviceMapping.js';

const SELECTOR = 'ext-freebox';
const gladys = { selector: SELECTOR };

/** Prefix a native id the way the core requires. */
const ext = (nativeId) => `ext:${SELECTOR}:${nativeId}`;

/** A client recording the endpoint writes instead of calling the Freebox. */
function fakeClient({ nodeValues = [] } = {}) {
  const writes = [];
  return {
    writes,
    setEndpointValue: async (appToken, nodeId, endpointId, value) => {
      writes.push({ nodeId, endpointId, value });
    },
    loadNodeValues: async () => nodeValues,
  };
}

// A `store_slider` shutter — the model the Freebox reports today — exposes only
// a position endpoint (ep 3) and a `stop` button (ep 1). There is NO open or
// close endpoint, so those commands are writes on the position endpoint.
const shutterDevice = {
  external_id: ext('freebox:21'),
  model: 'store_slider',
  features: [
    {
      external_id: ext('freebox:21:3'),
      category: 'shutter',
      type: 'position',
    },
    {
      external_id: ext('freebox:21:1'),
      category: 'shutter',
      type: 'state',
    },
  ],
};
const shutterStateFeature = shutterDevice.features[1];
const shutterPositionFeature = shutterDevice.features[0];

test('shutter open/close writes the position endpoint, not the stop button', async () => {
  const client = fakeClient();

  await setDeviceValue(
    gladys,
    client,
    'token',
    shutterDevice,
    shutterStateFeature,
    COVER_STATE.OPEN,
  );
  assert.deepEqual(client.writes[0], { nodeId: '21', endpointId: '3', value: 0 });

  await setDeviceValue(
    gladys,
    client,
    'token',
    shutterDevice,
    shutterStateFeature,
    COVER_STATE.CLOSE,
  );
  assert.deepEqual(
    client.writes[1],
    { nodeId: '21', endpointId: '3', value: 100 },
    'Freebox "Consigne d\'ouverture" is reversed: 100 = closed',
  );
});

// Stop is the only command that targets the `stop` endpoint, and it is a `void`
// endpoint: sending a payload makes the Freebox reject the call.
test('shutter stop presses the void stop endpoint with no payload', async () => {
  const client = fakeClient();
  await setDeviceValue(
    gladys,
    client,
    'token',
    shutterDevice,
    shutterStateFeature,
    COVER_STATE.STOP,
  );
  assert.deepEqual(client.writes[0], { nodeId: '21', endpointId: '1', value: null });
});

test('shutter position is inverted before being written', async () => {
  const client = fakeClient();
  await setDeviceValue(gladys, client, 'token', shutterDevice, shutterPositionFeature, 70);
  assert.deepEqual(client.writes[0], { nodeId: '21', endpointId: '3', value: 30 });
});

// The endpoint is read from the device features, not hard-coded, because it
// depends on the shutter model.
test('shutter open fails explicitly when the device has no position endpoint', async () => {
  const client = fakeClient();
  const brokenDevice = { ...shutterDevice, features: [shutterStateFeature] };
  await assert.rejects(
    () =>
      setDeviceValue(gladys, client, 'token', brokenDevice, shutterStateFeature, COVER_STATE.OPEN),
    /no position endpoint/,
  );
});

// Legacy `store` shutters expose one endpoint per direction.
test('legacy store shutters use their per-direction endpoints', async () => {
  const client = fakeClient();
  const device = { ...shutterDevice, model: 'store' };
  await setDeviceValue(gladys, client, 'token', device, shutterStateFeature, COVER_STATE.OPEN);
  await setDeviceValue(gladys, client, 'token', device, shutterStateFeature, COVER_STATE.CLOSE);
  assert.deepEqual(client.writes[0], { nodeId: '21', endpointId: 0, value: null });
  assert.deepEqual(client.writes[1], { nodeId: '21', endpointId: 2, value: null });
});

// Alarm commands are `void` endpoints too.
test('alarm buttons are pressed with a null payload', async () => {
  const client = fakeClient();
  const alarmDevice = {
    external_id: ext('freebox:9'),
    model: 'alarm_control',
    features: [{ external_id: ext('freebox:9:4'), category: 'button', type: 'push' }],
  };
  await setDeviceValue(gladys, client, 'token', alarmDevice, alarmDevice.features[0], 1);
  assert.deepEqual(client.writes[0], { nodeId: '9', endpointId: '4', value: null });
});

// --- Polling ---------------------------------------------------------------

/** Capture the states a poll publishes. */
function fakeGladys({ devices = [] } = {}) {
  const published = [];
  let getDevicesCalls = 0;
  return {
    selector: SELECTOR,
    published,
    devices,
    get getDevicesCalls() {
      return getDevicesCalls;
    },
    getDevices: async () => {
      getDevicesCalls += 1;
      return devices;
    },
    publishStates: async (states) => {
      published.push(...states);
    },
  };
}

// The core sends the poll and setValue payloads WITHOUT the device features
// (nor its name and model), exactly as observed in production:
//   onPoll <- ...:freebox:30 ("undefined", model=undefined, 0 feature(s))
// Every handler reading device.features then silently did nothing.
const bareDevice = { external_id: ext('freebox:21') };

test('polling resolves the features from the SDK cache when the core sends none', async () => {
  const target = fakeGladys({ devices: [shutterDevice] });
  const client = fakeClient({ nodeValues: [{ ep_id: 3, value: 85 }] });

  await pollDevice(target, client, 'token', bareDevice);

  assert.deepEqual(target.published[0], {
    device_feature_external_id: ext('freebox:21:3'),
    state: 15,
  });
  assert.equal(target.getDevicesCalls, 0, 'the cache is enough, no refetch');
});

// A device created while the integration is running is not in the cache yet.
test('polling refetches the devices when the cache misses', async () => {
  const target = fakeGladys({ devices: [] });
  target.devices = [];
  const client = fakeClient({ nodeValues: [{ ep_id: 3, value: 85 }] });
  // getDevices() refreshes the cache the SDK exposes.
  target.getDevices = async () => {
    target.devices = [shutterDevice];
    return target.devices;
  };

  await pollDevice(target, client, 'token', bareDevice);

  assert.equal(target.published.length, 1);
});

// `model` drives the shutter routing: letting the core's undefined overwrite
// the cached value would send open/close to the wrong endpoint.
test('a bare setValue keeps the cached model and features', async () => {
  const target = fakeGladys({ devices: [{ ...shutterDevice, model: 'store' }] });
  const client = fakeClient();

  await setDeviceValue(target, client, 'token', bareDevice, shutterStateFeature, COVER_STATE.OPEN);

  assert.deepEqual(
    client.writes[0],
    { nodeId: '21', endpointId: 0, value: null },
    'the cached "store" model routes to its own open endpoint',
  );
});

test('a bare shutter command finds the position endpoint through the cache', async () => {
  const target = fakeGladys({ devices: [shutterDevice] });
  const client = fakeClient();

  await setDeviceValue(target, client, 'token', bareDevice, shutterStateFeature, COVER_STATE.CLOSE);

  assert.deepEqual(client.writes[0], { nodeId: '21', endpointId: '3', value: 100 });
});

// The write-only shutter control has no readable state. Publishing a string in
// the numeric `state` column used to make the core reject the WHOLE batch,
// which is why no value at all reached the dashboard.
test('polling a shutter publishes the position and skips the write-only control', async () => {
  const target = fakeGladys();
  const client = fakeClient({
    nodeValues: [
      { ep_id: 3, value: 85 },
      { ep_id: 1, value: null },
    ],
  });

  await pollDevice(target, client, 'token', shutterDevice);

  assert.equal(target.published.length, 1);
  assert.deepEqual(target.published[0], {
    device_feature_external_id: ext('freebox:21:3'),
    state: 15,
  });
});

// The alarm panel state is a string: it has to travel through `text`.
test('polling publishes a textual state through the text field', async () => {
  const target = fakeGladys();
  const client = fakeClient({ nodeValues: [{ ep_id: 11, value: 'idle' }] });
  const device = {
    external_id: ext('freebox:9'),
    model: 'alarm_control',
    features: [{ external_id: ext('freebox:9:11'), category: 'text', type: 'text' }],
  };

  await pollDevice(target, client, 'token', device);

  assert.deepEqual(target.published[0], {
    device_feature_external_id: ext('freebox:9:11'),
    text: 'idle',
  });
});

// A sensor the Freebox has never refreshed answers `value: null`; publishing a
// 0 would show a false "closed" / "empty battery" state on the dashboard.
test('polling publishes nothing for endpoints without a value', async () => {
  const target = fakeGladys();
  const client = fakeClient({
    nodeValues: [
      { ep_id: 9, value: null },
      { ep_id: 6, value: null },
    ],
  });
  const device = {
    external_id: ext('freebox:16'),
    model: 'alarm_sensor',
    features: [
      { external_id: ext('freebox:16:9'), category: 'battery', type: 'integer' },
      { external_id: ext('freebox:16:6'), category: 'motion-sensor', type: 'binary' },
    ],
  };

  await pollDevice(target, client, 'token', device);

  assert.equal(target.published.length, 0);
});

// Defensive: no cache, no getDevices (or a failing one). The poll must warn
// and give up, never throw and mask the real problem behind a stack trace.
test('polling a device with no resolvable feature stays silent', async () => {
  const target = fakeGladys({ devices: [] });
  target.getDevices = async () => {
    throw new Error('host unreachable');
  };
  const client = fakeClient({ nodeValues: [{ ep_id: 3, value: 85 }] });

  await pollDevice(target, client, 'token', bareDevice);

  assert.equal(target.published.length, 0);
});

// The Freebox player has no on/off endpoint: power goes through the remote
// control "power" key, which toggles. Asking for a state the player is already
// in must NOT send the key, otherwise "turn the TV on" in a scene switches off
// a player that was already running.
const playerDevice = {
  external_id: ext('freebox:player:1'),
  model: 'player',
  params: [{ name: 'PLAYER_API_VERSION', value: 'v7' }],
  features: [
    { external_id: ext('freebox:player:1:binary'), category: 'television', type: 'binary' },
  ],
};
const playerPowerFeature = playerDevice.features[0];

/**
 * A client recording the player HTTP calls, answering a fixed power state and,
 * on the volume endpoint, the mute state it is given.
 */
function fakePlayerClient(powerState, { mute } = {}) {
  const calls = [];
  return {
    calls,
    playerRequest: async (appToken, options) => {
      calls.push(options);
      if (options.path.endsWith('/control/volume')) {
        return { data: { result: { volume: 25, mute } } };
      }
      return { data: { result: { power_state: powerState } } };
    },
  };
}

test('player power sends the remote key only when the state must change', async () => {
  const client = fakePlayerClient('standby');

  await setDeviceValue(gladys, client, 'token', playerDevice, playerPowerFeature, 1);

  assert.deepEqual(client.calls[0], { path: '/player/1/api/v7/status/' });
  assert.deepEqual(client.calls[1], {
    method: 'POST',
    path: '/player/1/api/v7/control/remote',
    data: { key: 'power' },
  });
});

test('player power is a no-op when the player is already in the wanted state', async () => {
  const client = fakePlayerClient('running');

  await setDeviceValue(gladys, client, 'token', playerDevice, playerPowerFeature, 1);

  assert.equal(client.calls.length, 1, 'only the status read, no toggle');

  await setDeviceValue(gladys, client, 'token', playerDevice, playerPowerFeature, 0);

  assert.deepEqual(client.calls[2], {
    method: 'POST',
    path: '/player/1/api/v7/control/remote',
    data: { key: 'power' },
  });
});

/** Build a player feature of the given television type. */
function playerFeature(type) {
  return { external_id: ext(`freebox:player:1:${type}`), category: 'television', type };
}

/** Capture the INFO lines written while running `fn`. */
async function captureLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

// The core commands with a MINIMAL feature payload: external_id, category and
// type, but no `name`. Logging `feature.name` straight away printed
// `Freebox set "undefined" = 1`, which made the command lines unreadable.
test('the command log names the feature even when the core omits it', async () => {
  const client = fakeClient();
  const device = {
    external_id: ext('freebox:28'),
    model: 'store_slider',
    features: [
      { external_id: ext('freebox:28:3'), category: 'shutter', type: 'position', name: 'Position' },
      { external_id: ext('freebox:28:1'), category: 'shutter', type: 'state', name: 'Volet salon' },
    ],
  };
  // What the core actually hands over: same external_id, no name.
  const bareFeature = { external_id: ext('freebox:28:1'), category: 'shutter', type: 'state' };

  const logs = await captureLogs(() =>
    setDeviceValue(gladys, client, 'token', device, bareFeature, COVER_STATE.OPEN),
  );

  assert.match(logs, /Freebox set "Volet salon"/);
  assert.doesNotMatch(logs, /undefined/);
});

test('the command log falls back on the type when no name is known anywhere', async () => {
  const client = fakeClient();
  const device = {
    external_id: ext('freebox:28'),
    model: 'store_slider',
    features: [{ external_id: ext('freebox:28:1'), category: 'shutter', type: 'state' }],
  };

  const logs = await captureLogs(() =>
    setDeviceValue(gladys, client, 'token', device, device.features[0], COVER_STATE.STOP),
  );

  assert.match(logs, /Freebox set "state"/);
  assert.doesNotMatch(logs, /undefined/);
});

// Zapping is a REMOTE key, not a mediactrl command: `next`/`prev` move to the
// next track of the media being played, which is why pressing them did nothing
// for a user expecting to change TV channel.
test('player zapping and TV keys go to the remote control endpoint', async () => {
  const cases = [
    ['channel-up', 'prgm_inc'],
    ['channel-down', 'prgm_dec'],
    ['source', 'tv'],
    ['menu', 'home'],
    ['enter', 'ok'],
    ['return', 'back'],
  ];

  for (const [type, key] of cases) {
    const client = fakePlayerClient('running');
    await setDeviceValue(gladys, client, 'token', playerDevice, playerFeature(type), 1);
    assert.deepEqual(
      client.calls,
      [{ method: 'POST', path: '/player/1/api/v7/control/remote', data: { key } }],
      `${type} must press the "${key}" remote key`,
    );
  }
});

test('player media features still go to mediactrl', async () => {
  const client = fakePlayerClient('running');

  await setDeviceValue(gladys, client, 'token', playerDevice, playerFeature('next'), 1);

  assert.deepEqual(client.calls, [
    { method: 'POST', path: '/player/1/api/v7/control/mediactrl', data: { cmd: 'next' } },
  ]);
});

// The dashboard renders mute as a one-shot button: every press sends the SAME
// value. Trusting it re-sent `mute: true` forever and the sound never came back
// (reported on a Devialet player), so the command must flip the real state.
const mutePlayerDevice = {
  external_id: ext('freebox:player:1'),
  model: 'player',
  params: [{ name: 'PLAYER_API_VERSION', value: 'v7' }],
  features: [
    {
      external_id: ext('freebox:player:1:volume-mute'),
      category: 'television',
      type: 'volume-mute',
      name: 'Mute',
    },
  ],
};
const muteFeature = mutePlayerDevice.features[0];

/** A Gladys stub recording the states published back to the core. */
function gladysWithStates() {
  const published = [];
  return {
    selector: SELECTOR,
    published,
    publishStates: async (states) => {
      published.push(...states);
    },
  };
}

test('pressing mute twice unmutes: the command flips the real state', async () => {
  const core = gladysWithStates();

  // First press: the player is not muted, so it must be muted.
  const muting = fakePlayerClient('running', { mute: false });
  await setDeviceValue(core, muting, 'token', mutePlayerDevice, muteFeature, 1);
  const muteWrite = muting.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(muteWrite.data, { mute: true });

  // Second press sends the SAME value, and must unmute anyway.
  const unmuting = fakePlayerClient('running', { mute: true });
  await setDeviceValue(core, unmuting, 'token', mutePlayerDevice, muteFeature, 1);
  const unmuteWrite = unmuting.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(unmuteWrite.data, { mute: false }, 'the second press restores the sound');
});

// The poll can be a minute away: without an immediate publish the dashboard
// keeps showing the old state, which invites another (useless) click.
test('the mute state is published right after the command', async () => {
  const core = gladysWithStates();
  const client = fakePlayerClient('running', { mute: false });

  await setDeviceValue(core, client, 'token', mutePlayerDevice, muteFeature, 1);

  assert.deepEqual(core.published, [
    { device_feature_external_id: ext('freebox:player:1:volume-mute'), state: 1 },
  ]);
});

// A player that just woke up can refuse the read; the command must still go out
// rather than being silently dropped.
test('an unreadable mute state falls back on the requested value', async () => {
  const core = gladysWithStates();
  const client = {
    calls: [],
    playerRequest: async (appToken, options) => {
      client.calls.push(options);
      if (options.path.endsWith('/control/volume') && !options.method) {
        throw new Error('player busy');
      }
      return { data: { result: {} } };
    },
  };

  await setDeviceValue(core, client, 'token', mutePlayerDevice, muteFeature, 1);

  const write = client.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(write.data, { mute: true });
});

// The documented API has no separate `play` / `pause`: it exposes the single
// `play_pause` toggle, so both Gladys features must send that command.
test('play and pause both send the documented play_pause toggle', async () => {
  for (const type of ['play', 'pause']) {
    const client = fakePlayerClient('running');
    await setDeviceValue(gladys, client, 'token', playerDevice, playerFeature(type), 1);
    assert.deepEqual(
      client.calls,
      [{ method: 'POST', path: '/player/1/api/v7/control/mediactrl', data: { cmd: 'play_pause' } }],
      `${type} must send play_pause`,
    );
  }
});

// Tuning by number is the only zapping the official documentation describes.
test('setting a channel number opens a tv: url', async () => {
  const client = fakePlayerClient('running');

  await setDeviceValue(gladys, client, 'token', playerDevice, playerFeature('channel'), 123);

  assert.deepEqual(client.calls, [
    {
      method: 'POST',
      path: '/player/1/api/v7/control/open',
      data: { url: 'tv:?channel=123' },
    },
  ]);
});

test('an invalid channel number is rejected instead of opening a broken url', async () => {
  // "12abc" matters: parseInt would silently tune channel 12 instead.
  for (const bad of ['', 'abc', 0, -3, '12abc', 12.9, null]) {
    const client = fakePlayerClient('running');
    await assert.rejects(
      setDeviceValue(gladys, client, 'token', playerDevice, playerFeature('channel'), bad),
      /invalid channel number/,
      `${JSON.stringify(bad)} must be rejected`,
    );
    assert.equal(client.calls.length, 0, 'nothing is sent to the Freebox');
  }
});

test('an unmanaged player feature type is reported', async () => {
  const client = fakePlayerClient('running');

  await assert.rejects(
    setDeviceValue(gladys, client, 'token', playerDevice, playerFeature('shuffle'), 1),
    /is not managed/,
  );
});
