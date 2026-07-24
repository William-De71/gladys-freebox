// -----------------------------------------------------------------------------
// Camera snapshot capture.
//
// The Freebox exposes an HLS stream URL (stored as the CAMERA_URL device param).
// We spawn ffmpeg to grab a single frame and return it in the SDK image format
// (`image/jpg;base64,...`, kept under 150 KB by scaling down).
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'freebox-camera' });

const MAX_IMAGE_BYTES = 150 * 1024;

/**
 * Read the camera stream URL from a Gladys device.
 * @param {object} device - Gladys camera device.
 * @returns {string|null} The stream URL, or null if missing.
 */
function getCameraUrl(device) {
  const param = (device.params || []).find((p) => p.name === 'CAMERA_URL');
  return param ? param.value : null;
}

/**
 * Capture a single JPEG frame from a Freebox camera stream with ffmpeg.
 * @param {object} device - Gladys camera device (carries the CAMERA_URL param).
 * @param {object} [options] - Options.
 * @param {number} [options.timeoutMs] - Kill ffmpeg after this delay (default 12s).
 * @returns {Promise<string>} `image/jpg;base64,...` string, <= 150 KB.
 * @example
 * const image = await captureCameraImage(device);
 */
export function captureCameraImage(device, { timeoutMs = 12000 } = {}) {
  const url = getCameraUrl(device);
  if (!url) {
    return Promise.reject(
      new Error(`Freebox camera "${device.external_id}" has no CAMERA_URL param`),
    );
  }

  return new Promise((resolve, reject) => {
    // -frames:v 1  -> a single frame
    // -vf scale     -> downscale so the JPEG stays under 150 KB
    // -f image2pipe -> write the JPEG to stdout
    const args = [
      '-y',
      '-loglevel',
      'error',
      '-i',
      url,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(1280,iw)':-2",
      '-q:v',
      '5',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ];

    const ffmpeg = spawn('ffmpeg', args);
    const chunks = [];
    let stderr = '';

    const timer = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms capturing ${device.external_id}`));
    }, timeoutMs);

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not be spawned: ${err.message}`));
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || buffer.length === 0) {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr.trim() || 'no output'}`));
        return;
      }
      if (buffer.length > MAX_IMAGE_BYTES) {
        logger.warn(
          `Freebox camera image is ${buffer.length} bytes, above the 150 KB limit; sending anyway`,
        );
      }
      resolve(`image/jpg;base64,${buffer.toString('base64')}`);
    });
  });
}
