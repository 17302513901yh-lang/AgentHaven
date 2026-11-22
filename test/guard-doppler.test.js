'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redact every documented Doppler auth token family', () => {
  for (const prefix of [
    'dp.ct.', 'dp.pt.', 'dp.st.', 'dp.st.dev.',
    'dp.sa.', 'dp.said.', 'dp.scim.', 'dp.audit.',
  ]) {
    for (const size of [40, 44]) {
      const token = prefix + 'Ab3x'.repeat(size / 4); // Synthetic only.
      for (const value of [token, 'Doppler credential ' + token + ' needs rotation']) {
        const result = inspect(value);
        assert.deepEqual(result.secrets, ['Doppler authentication token'], prefix);
        assert.equal(result.text, value.replace(token, '[Doppler authentication token removed]'));
        assert.ok(!result.text.includes(token));
        assert.deepEqual(inspect(result.text).secrets, []);
      }
    }
  }
});

test('guard: refuse partial Doppler matches and non-token identifiers', () => {
  const token = 'dp.st.dev.' + 'Ab3x'.repeat(10);
  for (const value of [
    'dp.st.dev.' + 'A'.repeat(39),
    'dp.st.dev.' + 'A'.repeat(45),
    'dp.st.d.' + 'A'.repeat(40),
    'dp.st.' + 'd'.repeat(36) + '.' + 'A'.repeat(40),
    'dp.invalid.' + 'A'.repeat(40),
    'prefix_' + token,
    'not' + token,
    token + '_suffix',
    token + '.other',
    'dp.ct.' + 'A'.repeat(100_000),
  ]) {
    assert.deepEqual(inspect(value).secrets, [], value.slice(0, 80));
  }
});
