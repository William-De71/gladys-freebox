import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../src/messages.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

test('every user-facing message is translated in the four Gladys languages', () => {
  Object.entries(MESSAGES).forEach(([key, message]) => {
    const value = typeof message === 'function' ? message('X') : message;
    LANGUAGES.forEach((lang) => {
      assert.ok(
        typeof value[lang] === 'string' && value[lang].trim().length > 0,
        `MESSAGES.${key} lacks "${lang}"`,
      );
    });
  });
});

test('parameterized messages keep the value untranslated in every language', () => {
  const message = MESSAGES.connectionOk(7);
  LANGUAGES.forEach((lang) => assert.match(message[lang], /\b7\b/));
});
