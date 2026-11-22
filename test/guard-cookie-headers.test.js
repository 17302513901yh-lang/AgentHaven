'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redacts Cookie and Set-Cookie session values before persistence', () => {
  for (const [header, prefix] of [
    ['Cookie: session=abc123; csrf=xyz789', 'Cookie: '],
    ['set-cookie: sid=abc123; HttpOnly; Secure', 'set-cookie: '],
    ['  Cookie: bearer=lowentropy', '  Cookie: '],
  ]) {
    const scanned = inspect(`before\n${header}\nafter`);
    assert.equal(scanned.text, `before\n${prefix}[cookie value removed]\nafter`);
    assert.deepEqual(scanned.secrets, ['HTTP cookie header']);
    assert.deepEqual(inspect(scanned.text).secrets, [], 'redaction is idempotent');
  }
});

test('guard: does not redact prose or unrelated headers mentioning cookies', () => {
  for (const ordinary of [
    'Cookie: oatmeal raisin',
    'Set-Cookie: not a header',
    'Please set Cookie: session=abc123 in the docs',
    'X-Cookie: session=abc123',
  ]) {
    assert.equal(inspect(ordinary).text, ordinary);
    assert.deepEqual(inspect(ordinary).secrets, []);
  }
});
