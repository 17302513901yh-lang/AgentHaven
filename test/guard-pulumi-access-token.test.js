'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redact complete Pulumi Cloud access token values', () => {
  const tokens = [
    "pul-a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1"
  ];
  for (const token of tokens) {
    const result = inspect('credential ' + token + ' done');
    assert.equal(result.text, 'credential [Pulumi Cloud access token removed] done');
    assert.deepEqual(result.secrets, ['Pulumi Cloud access token']);
    assert.deepEqual(inspect(result.text).secrets, []);
  }
});

test('guard: ignore incomplete Pulumi Cloud access token values and unrelated identifiers', () => {
  const nearMisses = [
    "pul-a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1",
    "pul-A1A1A1A1" + "A1A1A1A1A1A1" + "A1A1A1A1A1A1" + "A1A1A1A1",
    "pul-a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a10",
    "prefixpul-a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1",
    "pul- is a do" + "cumented tok" + "en prefix."
  ];
  for (const text of nearMisses) assert.deepEqual(inspect(text).secrets, [], text.slice(0, 24));
});
