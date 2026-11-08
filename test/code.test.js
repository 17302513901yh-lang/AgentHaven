'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store } = require('../src/store');
const gitx = require('../src/git');
const checks = require('../src/checks');
const { createHandler } = require('../src/mcp');

const tmp = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
const commitAll = (dir, msg) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', msg); };
const node = JSON.stringify(process.execPath);

function setup() {
  const repo = tmp('ah-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'src/a.js', 'a\n'); write(repo, 'src/b.js', 'b\n'); write(repo, 'test/a.test.js', 'ok\n');
  commitAll(repo, 'init');
  const s = new Store({ dataDir: tmp('ah-data-') });
  gitx.setRepo(s, { actor: 'you', dir: repo });
  return { repo, s };
}

test('code: only a human sets the repository and the checks', () => {
  const { repo, s } = setup();
  assert.deepEqual(s.getSettings().repo, { path: repo, base: 'main' });
  assert.throws(() => gitx.setRepo(s, { actor: 'codex', dir: repo }), /only a human/);
  s.takeLead({ actor: 'you', agent: 'lead-bot' });
  assert.throws(() => checks.setChecks(s, { actor: 'lead-bot', checks: [{ command: 'rm -rf /' }] }), /only a human/, 'not even the lead');
  assert.throws(() => gitx.setRepo(s, { actor: 'you', dir: os.tmpdir() }), /git rev-parse failed|not a git repository/i);
});

test('code: worktree per task, scope check flags edits outside the claim and on others\' files', () => {
  const { s } = setup();
  const a = s.createTask({ title: 'Change A', files: ['src/a.js'], actor: 'you' });
  const b = s.createTask({ title: 'Change B', files: ['src/b.js'], actor: 'you' });
  s.claimTask(a.id, { actor: 'codex' });
  s.claimTask(b.id, { actor: 'gemini' });
  assert.throws(() => gitx.createWorktree(s, a.id, { actor: 'gemini' }), /codex holds this task/);
  const wa = gitx.createWorktree(s, a.id, { actor: 'codex' });
  assert.ok(fs.existsSync(path.join(wa.path, 'src', 'a.js')));
  assert.match(wa.branch, /^agenthaven\/.+-change-a$/);
  assert.equal(gitx.createWorktree(s, a.id, { actor: 'codex' }).path, wa.path, 'idempotent');

  write(wa.path, 'src/a.js', 'a2\n');
  assert.equal(gitx.checkScope(s, a.id, { actor: 'codex' }).ok, true);
  write(wa.path, 'src/b.js', 'b-by-codex\n');
  write(wa.path, 'docs/new.md', 'x\n');
  const sc = gitx.checkScope(s, a.id, { actor: 'codex' });
  assert.equal(sc.ok, false);
  assert.deepEqual(sc.outOfScope, ['docs/new.md', 'src/b.js']);
  assert.equal(sc.foreign[0].agent, 'gemini');
  assert.match(s.inbox({ actor: 'gemini' }).messages[0].body, /changed src\/b\.js in "Change A"/);
  assert.match(s.inbox({ actor: 'codex' }).messages[0].body, /outside the task's files/);
});

test('code: conflict radar finds files changed on two branches', () => {
  const { s } = setup();
  const a = s.createTask({ title: 'Refactor', actor: 'you' });
  const b = s.createTask({ title: 'Bugfix', actor: 'you' });
  s.claimTask(a.id, { actor: 'codex' });
  s.claimTask(b.id, { actor: 'claude' });
  const wa = gitx.createWorktree(s, a.id, { actor: 'codex' });
  const wb = gitx.createWorktree(s, b.id, { actor: 'claude' });
  write(wa.path, 'src/a.js', 'refactor\n'); commitAll(wa.path, 'refactor');
  write(wb.path, 'src/a.js', 'fix\n'); write(wb.path, 'src/b.js', 'fix\n'); commitAll(wb.path, 'fix');
  const r = gitx.radar(s);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0].files, ['src/a.js']);
  assert.deepEqual([r.conflicts[0].a.agent, r.conflicts[0].b.agent].sort(), ['claude', 'codex']);
});

test('code: approval needs AgentHaven\'s own passing checks on the submitted commit', async () => {
  const { s } = setup();
  checks.setChecks(s, { actor: 'you', checks: [{ name: 'tests', command: `${node} -e "process.exit(require('fs').readFileSync('src/a.js','utf8').includes('bug') ? 1 : 0)"` }] });
  s.registerAgent({ actor: 'gemini', skills: ['review'] });
  const t = s.createTask({ title: 'Feature', files: ['src/a.js'], review: true, actor: 'you' });
  s.claimTask(t.id, { actor: 'codex' });
  const w = gitx.createWorktree(s, t.id, { actor: 'codex' });

  // Uncommitted work cannot be submitted.
  write(w.path, 'src/a.js', 'bug\n');
  assert.throws(() => checks.submit(s, t.id, { actor: 'codex', summary: 's', verification: 'tests pass' }), /commit your changes first/);
  commitAll(w.path, 'feature with a bug');

  // The agent says "tests pass"; AgentHaven runs them and they fail.
  const sub = checks.submit(s, t.id, { actor: 'codex', summary: 'feature', verification: 'tests pass (trust me)' });
  assert.equal(sub.receipt.status, 'running');
  assert.throws(() => s.reviewTask(t.id, { actor: 'gemini', approve: true }), /still running/);
  const failed = await checks.runReceipt(s, t.id, sub.receipt.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.results[0].exitCode, 1);
  assert.throws(() => s.reviewTask(t.id, { actor: 'gemini', approve: true }), /checks failed/);
  assert.match(s.inbox({ actor: 'codex' }).messages.find((m) => m.kind === 'checks').body, /FAILED/);

  // Fixed, committed, resubmitted: approval goes through.
  s.reviewTask(t.id, { actor: 'gemini', approve: false, comment: 'checks fail' });
  write(w.path, 'src/a.js', 'good\n'); commitAll(w.path, 'fix');
  const sub2 = checks.submit(s, t.id, { actor: 'codex', summary: 'fixed', verification: 'tests pass' });
  assert.notEqual(sub2.receipt.sha, sub.receipt.sha);
  assert.equal((await checks.runReceipt(s, t.id, sub2.receipt.id)).status, 'passed');
  assert.equal(s.reviewTask(t.id, { actor: 'gemini', approve: true }).status, 'done');
});

test('code: weakening the tests needs a human, even with green checks', async () => {
  const { s } = setup();
  checks.setChecks(s, { actor: 'you', checks: [{ name: 'tests', command: `${node} -e "0"` }] });
  const t = s.createTask({ title: 'Make it pass', files: ['src/a.js', 'test/'], review: true, actor: 'you' });
  s.claimTask(t.id, { actor: 'codex' });
  const w = gitx.createWorktree(s, t.id, { actor: 'codex' });
  write(w.path, 'test/a.test.js', 'skip everything\n'); commitAll(w.path, 'loosen the test');
  const sub = checks.submit(s, t.id, { actor: 'codex', summary: 'green now', verification: 'all tests pass' });
  assert.deepEqual(s.getTask(t.id).protectedTouched, ['test/a.test.js']);
  assert.equal((await checks.runReceipt(s, t.id, sub.receipt.id)).status, 'passed');
  assert.throws(() => s.reviewTask(t.id, { actor: 'gemini', approve: true }), /protected paths \(test\/a\.test\.js\): a human must approve/);
  assert.equal(s.reviewTask(t.id, { actor: 'you', approve: true }).status, 'done');
});

test('code: MCP tools and the background runner', async () => {
  const { s } = setup();
  checks.setChecks(s, { actor: 'you', checks: [{ name: 'ok', command: `${node} -e "console.log('all good')"` }] });
  const h = createHandler({ store: s, agent: 'codex' });
  const call = (name, args) => { const r = h({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result; return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text); };
  const t = call('create_task', { title: 'Docs', files: ['src/'] });
  call('claim_task', { id: t.id });
  const w = call('create_worktree', { id: t.id });
  write(w.path, 'src/c.js', 'c\n'); commitAll(w.path, 'c');
  assert.equal(call('check_scope', { id: t.id }).ok, true);
  const rc = call('run_checks', { id: t.id });
  for (let i = 0; i < 100 && s.getTask(t.id).receipts.slice(-1)[0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
  const done = s.getTask(t.id).receipts.find((r) => r.id === rc.id);
  assert.equal(done.status, 'passed', JSON.stringify(done));
  assert.match(done.results[0].tail, /all good/);
  assert.deepEqual(call('conflict_radar', {}).conflicts, []);
});
