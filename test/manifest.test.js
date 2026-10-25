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

test('catalog keywords and countries (Gladys 5.3.0)', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  keywords.forEach((keyword) => {
    assert.ok(keyword.trim().length >= 2 && keyword.trim().length <= 30, keyword);
  });
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length);
  assert.ok(!normalized.includes(manifest.name.toLowerCase()));
  // Free boxes are sold in France only.
  assert.deepEqual(manifest.countries, ['FR']);
});

// The four languages of the Gladys interface.
const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * Collect every localized object of the manifest (any object carrying `en`).
 * @param {any} node - Part of the manifest to walk.
 * @param {string} path - Where `node` sits, for the assertion message.
 * @returns {Array<{ path: string, value: object }>} The localized objects.
 * @example
 * localizedObjects(manifest, 'manifest');
 */
function localizedObjects(node, path) {
  if (!node || typeof node !== 'object') {
    return [];
  }
  if (!Array.isArray(node) && typeof node.en === 'string') {
    return [{ path, value: node }];
  }
  return Object.entries(node).flatMap(([key, child]) => localizedObjects(child, `${path}.${key}`));
}

test('every manifest text is translated in the four Gladys languages', () => {
  const texts = localizedObjects(manifest, 'manifest');
  assert.ok(texts.length > 0);
  texts.forEach(({ path, value }) => {
    LANGUAGES.forEach((lang) => {
      assert.ok(
        typeof value[lang] === 'string' && value[lang].trim().length > 0,
        `${path} lacks "${lang}"`,
      );
    });
  });
});

test('the pairing action outlasts the wait for the LCD confirmation', () => {
  const pair = manifest.actions.find((action) => action.key === 'pair');
  // 55 s of LCD wait, then discovery and publication of the devices.
  assert.ok(pair.timeout_seconds >= 90 && pair.timeout_seconds <= 120);
});

test('manifest exposes the pairing actions', () => {
  const keys = manifest.actions.map((action) => action.key);
  assert.deepEqual(keys, ['pair', 'test_connection', 'reboot', 'unpair']);
  manifest.actions.forEach((action) => {
    assert.ok(action.label.en && action.label.fr);
  });
});
