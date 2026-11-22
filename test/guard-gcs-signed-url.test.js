'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redacts Google Cloud Storage V4 HMAC and RSA URL signatures', () => {
  for (const signature of ['a1'.repeat(32), 'ab'.repeat(256)]) {
    const raw = 'https://storage.googleapis.com/test-bucket/object?' +
      'X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=' + signature +
      '&X-Goog-Expires=120';
    const result = inspect(raw);
    assert.deepEqual(result.secrets, ['Google Cloud Storage signed URL signature']);
    assert.equal(result.text,
      raw.replace(signature, '[Google Cloud Storage signed URL signature removed]'));
    assert.ok(!result.text.includes(signature));
    assert.deepEqual(inspect(result.text).secrets, [], 'must be idempotent');
  }
});

test('guard: signed URL matcher requires full hex and identifier boundaries', () => {
  for (const ordinary of [
    'X-Goog-Signature=' + 'a'.repeat(63),
    'X-Goog-Signature=' + 'z'.repeat(64),
    'X-Goog-Signature=' + 'a'.repeat(1025),
    'X-Goog-Signature=' + 'a'.repeat(64) + '_suffix',
    'X-Goog-SignedHeaders=host',
    'git commit ' + 'a'.repeat(40),
  ]) {
    assert.deepEqual(inspect(ordinary).secrets, [], ordinary.slice(0, 85));
  }
});

test('guard: signed URL query parameter matching is case-insensitive', () => {
  const raw = 'https://storage.googleapis.com/object?x-goog-signature=' + 'f'.repeat(64);
  assert.equal(inspect(raw).text, raw.replace('f'.repeat(64),
    '[Google Cloud Storage signed URL signature removed]'));
});
