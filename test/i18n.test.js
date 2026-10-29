import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, MESSAGES, connectionOk, format } from '../src/i18n.js';

test('every runtime message exists in every language', () => {
  for (const [key, message] of Object.entries(MESSAGES)) {
    assert.deepEqual(Object.keys(message).sort(), [...LANGUAGES].sort(), key);
    for (const lang of LANGUAGES) {
      assert.ok(message[lang].length > 0, `${key}.${lang}`);
    }
  }
});

test('composed messages cover every language', () => {
  const ok = connectionOk({ version: '5.0.9', total: 3, enabled: 2, hostPort: 41880 });
  assert.deepEqual(Object.keys(ok).sort(), [...LANGUAGES].sort());
  assert.match(ok.de, /5\.0\.9/);
  assert.deepEqual(
    format((lang) => lang),
    { en: 'en', fr: 'fr', de: 'de', es: 'es' },
  );
});
