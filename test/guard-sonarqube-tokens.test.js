'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redact complete SonarQube API token values', () => {
  const tokens = [
    "squ_a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1",
    "sqa_bcbcbcbc" + "bcbcbcbcbcbc" + "bcbcbcbcbcbc" + "bcbcbcbc",
    "sqp_dededede" + "dededededede" + "dededededede" + "dededede"
  ];
  for (const token of tokens) {
    const result = inspect('credential ' + token + ' done');
    assert.equal(result.text, 'credential [SonarQube API token removed] done');
    assert.deepEqual(result.secrets, ['SonarQube API token']);
    assert.deepEqual(inspect(result.text).secrets, []);
  }
});

test('guard: ignore incomplete SonarQube API token values and unrelated identifiers', () => {
  const nearMisses = [
    "squ_a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1",
    "squ_A1A1A1A1" + "A1A1A1A1A1A1" + "A1A1A1A1A1A1" + "A1A1A1A1",
    "sqb_a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1",
    "squ_a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a10",
    "prefixsqu_a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1",
    "squ_a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1a1a1" + "a1a1a1a1_suf" + "fix"
  ];
  for (const text of nearMisses) assert.deepEqual(inspect(text).secrets, [], text.slice(0, 24));
});
