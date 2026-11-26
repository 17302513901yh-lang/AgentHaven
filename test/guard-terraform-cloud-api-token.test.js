'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('guard: redact complete Terraform Cloud API token values', () => {
  const tokens = [
    "AAAAAAAAAAAA" + "AA.atlasv1.A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_",
    "BBBBBBBBBBBB" + "BB.atlasv1.a" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaB"
  ];
  for (const token of tokens) {
    const result = inspect('credential ' + token + ' done');
    assert.equal(result.text, 'credential [Terraform Cloud API token removed] done');
    assert.deepEqual(result.secrets, ['Terraform Cloud API token']);
    assert.deepEqual(inspect(result.text).secrets, []);
  }
});

test('guard: ignore incomplete Terraform Cloud API token values and unrelated identifiers', () => {
  const nearMisses = [
    "AAAAAAAAAAAA" + "AA.atlasv1.A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2",
    "BBBBBBBBBBBB" + "BB.atlasv1.a" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaBaBa" + "BaBaBaBaB_mo" + "re",
    "CCCCCCCCCCCC" + "CC.atlasv2.A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_A" + "b2_Ab2_Ab2_",
    "prefixAAAAAA" + "AAAAAAAA.atl" + "asv1.Ab2_Ab2" + "_Ab2_Ab2_Ab2" + "_Ab2_Ab2_Ab2" + "_Ab2_Ab2_Ab2" + "_Ab2_Ab2_Ab2" + "_Ab2_",
    "Terraform Cl" + "oud tokens c" + "ontain .atla" + "sv1. as a ma" + "rker."
  ];
  for (const text of nearMisses) assert.deepEqual(inspect(text).secrets, [], text.slice(0, 24));
});
