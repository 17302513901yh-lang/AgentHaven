'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redact complete Bitbucket API token values', () => {
  const tokens = [
    "ATATT3xFfGF0" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2=ABCDEF12"
  ];
  for (const token of tokens) {
    const result = inspect('credential ' + token + ' done');
    assert.equal(result.text, 'credential [Bitbucket API token removed] done');
    assert.deepEqual(result.secrets, ['Bitbucket API token']);
    assert.deepEqual(inspect(result.text).secrets, []);
  }
});

test('guard: ignore incomplete Bitbucket API token values and unrelated identifiers', () => {
  const nearMisses = [
    "ATATT3xFfGF0" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab=ABCDEF12",
    "ATATT3xFfGF0" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2=ABCDEF1z",
    "prefixATATT3" + "xFfGF0Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2_Ab" + "2_Ab2_Ab2=AB" + "CDEF12",
    "ATATT3xFfGF0" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2_Ab2_Ab2_" + "Ab2=ABCDEF12" + "Z",
    "ATAT is Bitb" + "ucket's API " + "token prefix" + "."
  ];
  for (const text of nearMisses) assert.deepEqual(inspect(text).secrets, [], text.slice(0, 24));
});
