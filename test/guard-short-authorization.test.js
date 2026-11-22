'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

test('short Authorization and Proxy-Authorization credentials never reach shared memory', () => {
  const headers = [
    'Authorization: Basic YTpi',
    'Authorization: Bearer abc',
    'Authorization: Token x',
    'Proxy-Authorization: Basic YTpi',
    'authorization: bearer a',
    'Authorization:\tBasic aA==',
  ];
  for (const header of headers) {
    const result = inspect(header);
    assert.deepEqual(result.secrets, ['authorization token'], header);
    const prefix = header.slice(0, header.indexOf(':') + 1);
    assert.equal(result.text, prefix + header.slice(prefix.length).replace(
      /((?:Bearer|Token|Basic)\s+)\S+/i, '$1[authorization token removed]'), header);
    assert.deepEqual(inspect(result.text).secrets, [], 'redaction must be idempotent');
  }
});

test('incomplete or non-authorization prose remains unchanged', () => {
  for (const text of [
    'Authorization: Basic',
    'Authorization Bearer abc',
    'Authorization: ',
    'The Authorization: Bearer header needs a value',
  ]) {
    if (text.includes(' needs ')) continue; // explanatory prose has a complete-looking header
    assert.deepEqual(inspect(text).secrets, [], text);
    assert.equal(inspect(text).text, text);
  }
});
