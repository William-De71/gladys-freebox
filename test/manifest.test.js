import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../gladys-assistant-integration.json', import.meta.url)),
    'utf8',
  ),
);

test('manifest declares the mandatory fields', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.docker_image, /:\d+\.\d+\.\d+$/);
  assert.ok(manifest.gladys_version.startsWith('>='));
});

test('manifest description is bilingual', () => {
  assert.ok(manifest.description.en.length > 0);
  assert.ok(manifest.description.fr.length > 0);
});

test('manifest exposes the pairing actions', () => {
  const keys = manifest.actions.map((action) => action.key);
  assert.deepEqual(keys, ['pair', 'test_connection', 'reboot', 'unpair']);
  manifest.actions.forEach((action) => {
    assert.ok(action.label.en && action.label.fr);
  });
});
