'use strict';
// Verified checks: an agent's "tests pass" is a claim, not evidence. Agents
// report passing tests they did not run, claim success after a failing run,
// or edit the tests until they pass (reward hacking). So AgentHaven runs the
// checks itself and keeps a receipt: which commands ran, on which commit,
// their exit codes and the end of their output.
//
// - A human sets the check commands. Agents can run them, never change them.
// - Submitting for review starts the checks on the submitted commit.
// - Review approval needs a passing receipt for that exact commit.
// - Changes to protected paths (tests by default) are flagged, and such work
//   needs a human's approval: an agent cannot quietly weaken the tests.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { Store, ConflictError, ValidationError, NotFoundError } = require('./store');
const gitx = require('./git');

const DEFAULT_PROTECTED = ['test/**', 'tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.go', '.github/workflows/**'];
const TAIL = 4000;
const MAX_CHECKS = 10;

function settingsOf(store) {
  const s = store.getSettings();
  return { checks: s.checks || [], protected: s.protectedPaths || DEFAULT_PROTECTED };
}

// Human only. A lead agent is an agent: it must not choose what "verified" means.
function setChecks(store, { actor, checks, protectedPaths }) {
  const data = store.read();
  if (!Store.isHuman(data, actor)) throw new ConflictError('only a human sets the check commands');
  const changes = {};
  if (checks !== undefined) {
    if (!Array.isArray(checks) || checks.length > MAX_CHECKS) throw new ValidationError(`checks must be a list of up to ${MAX_CHECKS} {name, command}`);
    changes.checks = checks.map((c) => {
      if (!c || typeof c.command !== 'string' || !c.command.trim()) throw new ValidationError('each check needs a command, e.g. {"name": "tests", "command": "npm test"}');
      const timeoutSec = c.timeoutSec === undefined ? 600 : Number(c.timeoutSec);
      if (!Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 7200) throw new ValidationError('timeoutSec must be 1 to 7200');
      return { name: String(c.name || c.command).slice(0, 60), command: c.command.trim().slice(0, 1000), timeoutSec };
    });
  }
  if (protectedPaths !== undefined) {
    if (!Array.isArray(protectedPaths)) throw new ValidationError('protectedPaths must be a list of globs');
    changes.protectedPaths = protectedPaths.map(String).filter(Boolean).slice(0, 50);
  }
  store.setSettings(changes, actor);
  return settingsOf(store);
}

function cwdOf(store, task) {
  const repo = store.getSettings().repo;
  const dir = task.worktree?.path || repo?.path;
  if (!dir || !fs.existsSync(dir)) throw new ValidationError('no repository or worktree to run checks in; a human sets the repository first');
  return { dir, base: task.worktree?.base || repo?.base };
}

// Inspects the submitted commit: its SHA and whether protected paths changed.
function inspectSubmission(store, task) {
  const { dir, base } = cwdOf(store, task);
  const { files, uncommitted } = gitx.changedFiles(dir, base);
  const globs = settingsOf(store).protected;
  return { sha: gitx.head(dir), protectedTouched: files.filter((f) => gitx.matchesAny(f, globs)), uncommitted };
}

// Starts the checks in the background and returns the pending receipt.
function startChecks(store, id, { actor, wait = false } = {}) {
  const { checks } = settingsOf(store);
  if (!checks.length) throw new ValidationError('no checks are configured; a human adds them in the dashboard (Checks)');
  const task = store.getTask(id);
  const { dir } = cwdOf(store, task);
  const sha = gitx.head(dir);
  const { uncommitted } = gitx.changedFiles(dir, task.worktree?.base || store.getSettings().repo?.base || 'HEAD');
  const receipt = { id: `rcpt_${crypto.randomBytes(5).toString('hex')}`, status: 'running', sha, dirty: uncommitted > 0, startedAt: new Date().toISOString(), by: actor, cwd: dir, results: [] };
  store.withLock((data) => {
    const t = Store.findTask(data, id);
    t.receipts = [...(t.receipts || []).slice(-9), receipt];
    Store.log(data, actor, 'checks.started', id, `${checks.map((c) => c.name).join(', ')} on ${sha.slice(0, 10)}`);
  });
  if (wait) return runReceipt(store, id, receipt.id);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'agenthaven.js'), 'run-checks', id, receipt.id, '--workspace', store.workspace],
    { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, AGENTHAVEN_HOME: store.dataDir, ELECTRON_RUN_AS_NODE: '1' } });
  child.unref();
  return receipt;
}

function runOne(check, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    const child = spawn(check.command, { cwd, shell: true, windowsHide: true, env: { ...process.env, CI: '1' } });
    const keep = (b) => { out = (out + b.toString()).slice(-TAIL * 2); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { out += `\n[AgentHaven: stopped after ${check.timeoutSec}s]`; child.kill('SIGKILL'); }, check.timeoutSec * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ name: check.name, command: check.command, exitCode: code ?? -1, signal: signal || null, durationMs: Date.now() - started, tail: out.slice(-TAIL) });
    });
    child.on('error', (err) => { clearTimeout(timer); resolve({ name: check.name, command: check.command, exitCode: -1, durationMs: Date.now() - started, tail: err.message }); });
  });
}

// Runs every check of a pending receipt and stores the outcome.
async function runReceipt(store, id, receiptId) {
  const { checks } = settingsOf(store);
  const task = store.getTask(id);
  const receipt = (task.receipts || []).find((r) => r.id === receiptId);
  if (!receipt) throw new NotFoundError(`receipt ${receiptId} not found`);
  const results = [];
  for (const check of checks) {
    const r = await runOne(check, receipt.cwd);
    results.push(r);
    if (r.exitCode !== 0) break; // later checks usually depend on earlier ones
  }
  let shaAfter = null;
  try { shaAfter = gitx.head(receipt.cwd); } catch { /* repo gone */ }
  const passed = results.length === checks.length && results.every((r) => r.exitCode === 0);
  return store.withLock((data) => {
    const t = Store.findTask(data, id);
    const rc = t.receipts.find((r) => r.id === receiptId);
    Object.assign(rc, { status: passed ? 'passed' : 'failed', results, finishedAt: new Date().toISOString(), moved: shaAfter && shaAfter !== rc.sha ? shaAfter : undefined });
    Store.log(data, 'agenthaven', passed ? 'checks.passed' : 'checks.failed', id, `${rc.sha.slice(0, 10)}: ${results.map((r) => `${r.name} ${r.exitCode === 0 ? 'ok' : `exit ${r.exitCode}`}`).join(', ')}`);
    const who = t.assignee || rc.by;
    if (who) Store.message(data, { from: 'agenthaven', to: who, body: `Checks ${passed ? 'passed' : 'FAILED'} on "${t.title}" (${rc.sha.slice(0, 10)}).${passed ? '' : ` ${results.find((r) => r.exitCode !== 0)?.name}: ${results.find((r) => r.exitCode !== 0)?.tail.slice(-300)}`}`, task: id, kind: 'checks' });
    if (t.status === 'review' && t.reviewer) Store.message(data, { from: 'agenthaven', to: t.reviewer, body: `Checks ${passed ? 'passed' : 'failed'} for "${t.title}" you are reviewing.`, task: id, kind: 'checks' });
    return rc;
  });
}

// Submit for review with the evidence attached: the commit, protected paths
// touched, a scope check, and the checks started on that commit.
function submit(store, id, opts) {
  const task = store.getTask(id);
  let extra = {};
  const hasRepo = Boolean(store.getSettings().repo?.path);
  if (hasRepo) {
    try { extra = inspectSubmission(store, task); } catch { extra = {}; }
    if (extra.uncommitted) throw new ConflictError(`commit your changes first: ${extra.uncommitted} uncommitted file(s) in ${task.worktree?.path || store.getSettings().repo.path}`, task);
  }
  const res = store.submitForReview(id, { ...opts, sha: extra.sha, protectedTouched: extra.protectedTouched });
  const out = { ...res };
  if (hasRepo) { try { out.scope = gitx.checkScope(store, id, { actor: opts.actor }); } catch { /* no git here */ } }
  if (hasRepo && settingsOf(store).checks.length) out.receipt = startChecks(store, id, { actor: opts.actor });
  return out;
}

module.exports = { submit, setChecks, settingsOf, startChecks, runReceipt, inspectSubmission, DEFAULT_PROTECTED };
