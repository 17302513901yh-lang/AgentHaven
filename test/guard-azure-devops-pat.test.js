'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redact Azure DevOps PATs before shared-memory writes', () => {
  const tokens = [
    "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAZDOBBBBB"
  ];
  for (const token of tokens) {
    const result = inspect(`credential ${token} done`);
    assert.equal(result.text, 'credential [Azure DevOps PAT removed] done');
    assert.deepEqual(result.secrets, ['Azure DevOps PAT']);
    assert.deepEqual(inspect(result.text).secrets, []);
  }
});

test('guard: ignore Azure DevOps PAT near-misses and identifiers', () => {
  const nearMisses = [
    "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAZDOBBBBBB",
    "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAZDOBBBB",
    "prefixAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAZD" + "OBBBBB",
    "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAAAAAAAAA" + "AAAAZDOBBBBB" + "_suffix",
    "The AZDO sig" + "nature ident" + "ifies a new " + "PAT."
  ];
  for (const text of nearMisses) assert.deepEqual(inspect(text).secrets, [], text.slice(0, 24));
});
