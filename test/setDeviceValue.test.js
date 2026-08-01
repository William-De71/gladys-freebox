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
function fakeGladys() {
  const published = [];
  return {
    selector: SELECTOR,
    published,
    publishStates: async (states) => {
      published.push(...states);
    },
  };
}

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
