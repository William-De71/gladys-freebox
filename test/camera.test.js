import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCameraImage } from '../src/freebox/camera.js';

// `captureCameraImage` spawns the real `ffmpeg` binary, so the retry is tested
// by putting a fake `ffmpeg` first on the PATH. The fake counts its runs in a
// file, which lets each scenario decide which attempt succeeds.
function withFakeFfmpeg(script) {
  const dir = mkdtempSync(join(tmpdir(), 'freebox-cam-'));
  const counterFile = join(dir, 'runs');
  const binary = join(dir, 'ffmpeg');
  writeFileSync(binary, script.replaceAll('__COUNTER__', counterFile), { mode: 0o755 });
  chmodSync(binary, 0o755);
  return {
    dir,
    runs: () => (existsSync(counterFile) ? readFileSync(counterFile, 'utf8').trim().length : 0),
  };
}

const device = {
  name: 'Caméra balcon',
  external_id: 'freebox:cam:1',
  params: [{ name: 'CAMERA_URL', value: 'http://user:pass@192.168.1.88/img/stream.m3u8' }],
};

/** Run a capture with the fake ffmpeg dir prepended to PATH. */
async function captureWith(fake) {
  const previousPath = process.env.PATH;
  process.env.PATH = `${fake.dir}:${previousPath}`;
  try {
    return await captureCameraImage(device, { timeoutMs: 5000 });
  } finally {
    process.env.PATH = previousPath;
  }
}

// An HLS segment listed in the .m3u8 can expire before ffmpeg fetches it. That
// transient failure used to surface as a "camera push failed" warning even
// though the camera was healthy, so the first failure must be retried.
test('a capture that fails once is retried and succeeds', async () => {
  const fake = withFakeFfmpeg(`#!/bin/sh
printf x >> __COUNTER__
if [ "$(wc -c < __COUNTER__)" -eq 1 ]; then
  echo "Error when loading first segment" >&2
  exit 183
fi
printf '\\377\\330fake-jpeg'
`);

  const image = await captureWith(fake);

  assert.match(image, /^image\/jpg;base64,/);
  assert.equal(fake.runs(), 2, 'the first attempt failed, the second one produced the frame');
});

test('a capture failing every time reports the last ffmpeg error', async () => {
  const fake = withFakeFfmpeg(`#!/bin/sh
printf x >> __COUNTER__
echo "Invalid data found when processing input" >&2
exit 183
`);

  await assert.rejects(captureWith(fake), /Invalid data found when processing input/);
  assert.equal(fake.runs(), 2, 'exactly one retry, not an infinite loop');
});

test('a camera without CAMERA_URL is rejected without spawning ffmpeg', async () => {
  await assert.rejects(
    captureCameraImage({ name: 'Nue', external_id: 'freebox:cam:2', params: [] }),
    /has no CAMERA_URL param/,
  );
});
