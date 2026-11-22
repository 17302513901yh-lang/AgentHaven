'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect } = require('../src/guard');

test('terminal CSI and OSC escapes are removed before shared-memory writes', () => {
  const cases = [
    ['before \x1b[2Jafter', 'before after'],
    ['before \x1b[31mafter\x1b[0m', 'before after'],
    ['before \x1b]8;;https://attacker.example/\x07after', 'before after'],
    ['before \x1b]8;;https://attacker.example/\x1b\\after', 'before after'],
    ['before \x1b]8;;https://attacker.example/', 'before '],
  ];
  for (const [raw, expected] of cases) {
    const result = inspect(raw);
    assert.equal(result.text, expected);
    assert.ok(result.injection.some((reason) => reason.includes('terminal escape sequence')), raw);
    assert.equal(inspect(result.text).text, result.text, 'cleaned text remains unchanged');
  }
});

test('ordinary text and newline formatting survive terminal-sequence sanitization', () => {
  const raw = 'One line\nNext line with [brackets] and a URL https://example.org';
  const result = inspect(raw);
  assert.equal(result.text, raw);
  assert.ok(!result.injection.some((reason) => reason.includes('terminal escape sequence')));
});
