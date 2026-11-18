'use strict';
// #79: link / sync / unlink / instructions / board / config have library tests,
// but no test ran the real CLI switch. These tests start bin/agenthaven.js in a
// temporary AGENTHAVEN_HOME and a temporary shared folder, so a wrong argument
// index or a renamed setting fails CI. Only tests change; no production code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'agenthaven.js');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-cli-cmds-'));
  const share = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-cli-share-'));
  const env = { ...process.env, AGENTHAVEN_HOME: home, AGENTHAVEN_WORKSPACE: 'default' };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args],
    { cwd: home, encoding: 'utf8', env });
  return { home, share, run };
}

test('link writes the workboard files and refuses a missing folder', () => {
  const { share, run } = fixture();
  const missing = run('link');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /usage: agenthaven link <folder>/);

  const linked = run('link', share);
  assert.equal(linked.status, 0);
  assert.match(linked.stdout, /Linked workspace "default" to/);
  assert.match(linked.stdout, /WORKBOARD\.md/);
  assert.ok(fs.existsSync(path.join(share, 'WORKBOARD.md')), 'WORKBOARD.md was created');
  assert.ok(fs.existsSync(path.join(share, 'LOGBOOK.md')), 'LOGBOOK.md was created');
});

test('sync applies an Inbox line; board, instructions and config print their answers', () => {
  const { share, run } = fixture();
  assert.equal(run('link', share).status, 0);

  const boardFile = path.join(share, 'WORKBOARD.md');
  fs.appendFileSync(boardFile, '\nyou: new P1 Try the board\n');
  const sync = run('sync');
  assert.equal(sync.status, 0);
  assert.match(sync.stdout, /1 command\(s\) applied/);
  assert.match(sync.stdout, /✓ you: new P1 Try the board — created task_/);

  const board = run('board');
  assert.equal(board.status, 0);
  assert.ok(board.stdout.startsWith('# Workboard — default'));

  const instructions = run('instructions');
  assert.equal(instructions.status, 0);
  assert.match(instructions.stdout, /## Shared workboard \(AgentHaven\)/);
  assert.match(instructions.stdout, /WORKBOARD\.md/);
  assert.ok(instructions.stdout.includes(boardFile), 'instructions name the linked WORKBOARD.md');

  const config = run('config', '--agent', 'codex', '--workspace', 'demo');
  assert.equal(config.status, 0);
  const parsed = JSON.parse(config.stdout);
  const args = parsed.mcpServers.agenthaven.args;
  assert.deepEqual(args.slice(-5), ['mcp', '--agent', 'codex', '--workspace', 'demo']);
});

test('unlink stops the sharing: sync and instructions then refuse', () => {
  const { share, run } = fixture();
  assert.equal(run('link', share).status, 0);
  const unlink = run('unlink');
  assert.equal(unlink.status, 0);
  assert.match(unlink.stdout, /is no longer shared as files/);

  for (const cmd of ['sync', 'instructions']) {
    const refused = run(cmd);
    assert.equal(refused.status, 1, `${cmd} without a link exits 1`);
    assert.match(refused.stderr, /is not linked to a folder; run: agenthaven link <folder>/);
  }
});

// #128: a typo in --workspace (or in AGENTHAVEN_WORKSPACE) used to print an
// empty board and exit 0. Only the two read-only commands refuse; `default`
// still counts as existing before any file has been written.
test('status and board refuse an unknown workspace, default stays usable', () => {
  const { home, share, run } = fixture();

  const fresh = run('status');
  assert.equal(fresh.status, 0);
  assert.match(fresh.stdout, /The board is empty\./);

  assert.equal(run('link', share, '--workspace', 'main').status, 0);
  const known = run('board', '--workspace', 'main');
  assert.equal(known.status, 0);
  assert.ok(known.stdout.startsWith('# Workboard — main'));

  for (const cmd of ['status', 'board']) {
    const bad = run(cmd, '--workspace', 'nosuch');
    assert.equal(bad.status, 1, `${cmd} with an unknown workspace must fail`);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /no workspace named "nosuch"; existing workspaces: default, main/);
  }

  const envBad = spawnSync(process.execPath, [CLI, 'status'], {
    cwd: home, encoding: 'utf8',
    env: { ...process.env, AGENTHAVEN_HOME: home, AGENTHAVEN_WORKSPACE: 'mian' },
  });
  assert.equal(envBad.status, 1);
  assert.match(envBad.stderr, /no workspace named "mian"; existing workspaces: default, main/);
});
