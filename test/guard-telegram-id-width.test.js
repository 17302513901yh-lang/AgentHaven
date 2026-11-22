'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../src/guard');

const suffix = 'Ab3_'.repeat(8) + 'Ab3'; // 35 synthetic token characters
test('Telegram bot tokens with 11-16-digit bot IDs are masked', () => {
  for (const id of ['12345678901', '123456789012', '123456789012345', '1234567890123456']) {
    const token = id + ':' + suffix;
    const result = inspect('Bot ' + token);
    assert.deepEqual(result.secrets, ['Telegram bot token']);
    assert.equal(result.text, 'Bot [Telegram bot token removed]');
    assert.deepEqual(inspect(result.text).secrets, []);
  }
});

test('non-bot identifiers and invalid lengths are not partially masked', () => {
  for (const id of ['1234567', '12345678901234567', '4503599627370496']) {
    const token = id + ':' + suffix;
    const result = inspect(token);
    assert.deepEqual(result.secrets, [], token);
    assert.equal(result.text, token);
  }
  assert.deepEqual(inspect('123456789012:' + 'A'.repeat(34)).secrets, []);
});
