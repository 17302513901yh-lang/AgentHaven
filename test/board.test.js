'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { createHandler, vendorOf } = require('../src/mcp');
const { start } = require('../src/server');
const wb = require('../src/workboard');

const tmpDir = (p = 'ah-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const tmpStore = (opts = {}) => new Store({ dataDir: tmpDir(), ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('leases: a quiet agent loses its claim, a heartbeat keeps it', async () => {
  const s = tmpStore({ leaseMs: 60 });
  const a = s.createTask({ title: 'A', files: ['src/a.js'], actor: 'x' });
  const b = s.createTask({ title: 'B', actor: 'x' });
  s.claimTask(a.id, { actor: 'claude' });
  s.claimTask(b.id, { actor: 'codex' });
  await sleep(40);
  s.heartbeat({ actor: 'codex' });
  await sleep(40);
  const after = s.getTask(a.id);
  assert.equal(after.status, 'todo');
  assert.equal(after.assignee, null);
  assert.match(after.handoffs.at(-1).summary, /Lease expired/);
  assert.equal(s.getTask(b.id).assignee, 'codex');
  assert.ok(s.activity().some((e) => e.action === 'task.lease_expired' && e.ref === a.id));
  assert.deepEqual(s.fileClaims(), []);
  assert.equal(s.claimTask(a.id, { actor: 'gemini' }).assignee, 'gemini');
});

test('dependencies: no claim before they are done, no cycles', () => {
  const s = tmpStore();
  const design = s.createTask({ title: 'Design', actor: 'x' });
  const build = s.createTask({ title: 'Build', dependsOn: [design.id], actor: 'x' });
  assert.deepEqual(s.listTasks().find((t) => t.id === build.id).waitingOn, [design.id]);
  assert.throws(() => s.claimTask(build.id, { actor: 'codex' }), /waiting on "Design"/);
  const d = s.getTask(design.id);
  assert.throws(() => s.updateTask(design.id, { version: d.version, dependsOn: [build.id], actor: 'x' }), /cycle/);
  assert.throws(() => s.createTask({ title: 'Z', dependsOn: ['task_nope'], actor: 'x' }), /not found/);
  s.updateTask(design.id, { version: d.version, status: 'done', actor: 'x' });
  assert.equal(s.claimTask(build.id, { actor: 'codex' }).status, 'doing');
});

test('next_task: priority first, skills and files respected, claims atomically', () => {
  const s = tmpStore();
  s.registerAgent({ actor: 'trainer', kind: 'neural-network', skills: ['GPU'] });
  const low = s.createTask({ title: 'Low', priority: 3, actor: 'x' });
  const gpu = s.createTask({ title: 'Train', priority: 0, skills: ['gpu'], actor: 'x' });
  const high = s.createTask({ title: 'High', priority: 'P1', files: ['src/'], actor: 'x' });
  const busy = s.createTask({ title: 'Busy', files: ['src/x.js'], actor: 'x' });
  s.claimTask(busy.id, { actor: 'gemini' });
  const forCodex = s.nextTask({ actor: 'codex' });
  assert.equal(forCodex.task.id, low.id, 'gpu task needs skills, src/ is in use');
  assert.ok(forCodex.skipped.some((r) => r.startsWith(gpu.id)));
  assert.ok(forCodex.skipped.some((r) => r.startsWith(high.id) && /gemini/.test(r)));
  const forTrainer = s.nextTask({ actor: 'trainer', claim: true });
  assert.equal(forTrainer.task.id, gpu.id);
  assert.equal(forTrainer.task.assignee, 'trainer');
  assert.ok(forTrainer.task.leaseUntil);
});

test('review: criteria and a second pair of eyes gate "done"', () => {
  const s = tmpStore();
  const t = s.createTask({ title: 'Fix', criteria: ['has test', 'docs updated'], review: true, actor: 'roel' });
  s.claimTask(t.id, { actor: 'codex' });
  let cur = s.getTask(t.id);
  assert.throws(() => s.updateTask(t.id, { version: cur.version, status: 'done', actor: 'codex' }), /criteria still open/);
  s.setCriterion(t.id, { actor: 'codex', criterion: '1', done: true });
  s.setCriterion(t.id, { actor: 'codex', criterion: 'docs updated', done: true });
  cur = s.getTask(t.id);
  assert.throws(() => s.updateTask(t.id, { version: cur.version, status: 'done', actor: 'codex' }), /review/);
  assert.throws(() => s.updateTask(t.id, { version: cur.version, status: 'done', actor: 'gemini' }), /codex holds this task/);
  s.submitForReview(t.id, { actor: 'codex', summary: 'done, tests green' });
  assert.throws(() => s.reviewTask(t.id, { actor: 'codex', approve: true }), /own work/);
  assert.throws(() => s.reviewTask(t.id, { actor: 'claude', approve: false }), /comment/);
  const back = s.reviewTask(t.id, { actor: 'claude', approve: false, comment: 'add an edge case' });
  assert.equal(back.status, 'doing');
  s.submitForReview(t.id, { actor: 'codex', summary: 'edge case added' });
  const ok = s.reviewTask(t.id, { actor: 'claude', approve: true, comment: 'lgtm' });
  assert.equal(ok.status, 'done');
  assert.equal(ok.reviewedBy, 'claude');
  assert.deepEqual(ok.comments.map((c) => c.kind), ['review-request', 'changes-requested', 'review-request', 'approval']);
});

test('a human may close or reassign any task', () => {
  const s = tmpStore();
  const t = s.createTask({ title: 'X', review: true, actor: 'roel' });
  s.claimTask(t.id, { actor: 'codex' });
  const cur = s.getTask(t.id);
  assert.equal(s.updateTask(t.id, { version: cur.version, status: 'done', actor: 'you' }).status, 'done');
});

test('progress: usage adds up, metrics become series, the budget blocks the task', () => {
  const s = tmpStore();
  const t = s.createTask({ title: 'Train', budget: { costUsd: 1 }, actor: 'roel' });
  assert.throws(() => s.reportProgress(t.id, { actor: 'trainer', progress: 10 }), /claim the task first/);
  s.claimTask(t.id, { actor: 'trainer' });
  s.reportProgress(t.id, { actor: 'trainer', progress: 25, usage: { costUsd: 0.6, tokens: 10 }, metrics: { loss: 1.2 } });
  const r = s.reportProgress(t.id, { actor: 'trainer', progress: 50, usage: { costUsd: 0.6 }, metrics: { loss: 0.8 } });
  assert.equal(r.status, 'blocked');
  assert.match(r.blockedReason, /Budget exceeded: \$1\.20 of \$1\.00/);
  const full = s.getTask(t.id);
  assert.deepEqual(full.metrics.loss.map((p) => p.v), [1.2, 0.8]);
  assert.equal(full.usage.tokens, 10);
  assert.deepEqual(s.listTasks()[0].metrics, { loss: 0.8 });
  assert.throws(() => s.reportProgress(t.id, { actor: 'trainer', progress: 120 }), /0\.\.100/);
  assert.throws(() => s.reportProgress(t.id, { actor: 'trainer', metrics: { loss: 'x' } }), /number/);
  assert.equal(s.stats().usage.costUsd, 1.2);
});

test('events: a cursor returns only what is new', () => {
  const s = tmpStore();
  const first = s.events({ since: 0 });
  s.createTask({ title: 'A', actor: 'x' });
  s.createTask({ title: 'B', actor: 'x' });
  const page = s.events({ since: first.cursor });
  assert.deepEqual(page.events.map((e) => e.detail), ['A', 'B']);
  assert.equal(s.events({ since: page.cursor }).events.length, 0);
});

test('paths normalise and delete needs a version', () => {
  const s = tmpStore();
  const t = s.createTask({ title: 'P', files: ['src//a.js', './src/./b.js', 'src/lib/../c.js', '.'], actor: 'x' });
  assert.deepEqual(t.files, ['src/a.js', 'src/b.js', 'src/c.js']);
  assert.throws(() => s.deleteTask(t.id, { actor: 'x' }), { code: 'INVALID' });
  const dep = s.createTask({ title: 'Q', dependsOn: [t.id], actor: 'x' });
  s.deleteTask(t.id, { version: 1, actor: 'x' });
  assert.deepEqual(s.getTask(dep.id).dependsOn, []);
});

test('schema 1 workspace files still load', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'default.json'), `﻿${JSON.stringify({ schema: 1, tasks: [{ id: 'task_aaaaaaaaaaaa', title: 'Old', description: '', status: 'todo', assignee: null, files: [], createdBy: 'x', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1 }], notes: [], log: [{ id: 'evt_1', at: '2026-01-01T00:00:00.000Z', actor: 'x', action: 'task.created' }] })}`);
  const s = new Store({ dataDir: dir });
  const [t] = s.listTasks();
  assert.equal(t.priority, 2);
  assert.deepEqual(t.criteria, []);
  assert.equal(s.claimTask(t.id, { actor: 'codex' }).status, 'doing');
  assert.equal(s.activity()[0].seq, 2);
});

test('workboard: agents of any vendor collaborate by editing WORKBOARD.md', () => {
  const s = tmpStore();
  const dir = tmpDir('ah-wb-');
  const file = path.join(dir, wb.BOARD);
  wb.syncOnce(s, dir);
  const add = (...lines) => fs.appendFileSync(file, `${lines.join('\n')}\n`);
  add('codex: hello kind=llm vendor=OpenAI model=gpt-5 skills=python', '- gemini: hello vendor=Google',
    'codex: new P1 Add retry [files: src/fetch.js] [criteria: retries 3 times; has test] [review]', 'nonsense');
  let r = wb.syncOnce(s, dir);
  assert.deepEqual(r.results.map((x) => x.ok), [true, true, true, false]);
  const [task] = s.listTasks();
  assert.equal(task.priority, 1);
  assert.deepEqual(task.files, ['src/fetch.js']);
  assert.equal(task.criteria.length, 2);
  const short = task.id.slice(5, 10);
  add(`gemini: next`, `codex: claim ${short}`, `gemini: progress ${short} 40% halfway | tokens=1000 cost=0.02 tests=12`,
    `gemini: check ${short} 1`, `gemini: check ${short} 2`, `gemini: done ${short} retry with backoff`, `gemini: approve ${short}`, `codex: approve ${short} nice`);
  r = wb.syncOnce(s, dir);
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, true, true, true, true, false, true]);
  assert.match(r.results[1].message, /claimed by gemini/);
  assert.match(r.results[6].message, /own work/);
  const done = s.getTask(task.id);
  assert.equal(done.status, 'done');
  assert.equal(done.reviewedBy, 'codex');
  assert.equal(done.usage.costUsd, 0.02);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /## Recently done[\s\S]*Add retry/);
  assert.match(text, /\| codex \| llm \| OpenAI \/ gpt-5 \|/);
  assert.match(text, /✗ `codex: approve|✗ `gemini: approve/);
  assert.deepEqual(wb.inboxLines(text), [], 'the Inbox is emptied after a sync');
  const log = fs.readFileSync(path.join(dir, wb.LOGBOOK), 'utf8');
  assert.match(log, /\*\*codex\*\* · approved/);
  const lines = log.split('\n').length;
  wb.syncOnce(s, dir);
  assert.equal(fs.readFileSync(path.join(dir, wb.LOGBOOK), 'utf8').split('\n').length, lines, 'the logbook is append-only, no repeats');
});

test('workboard: parsing helpers', () => {
  assert.deepEqual(wb.parseProgress('40% epoch 4 | loss=0.5 cost=0.1 tokens=20'), { progress: 40, message: 'epoch 4', usage: { costUsd: 0.1, tokens: 20 }, metrics: { loss: 0.5 } });
  assert.throws(() => wb.parseProgress('10% | loss=abc'), /key=number/);
  const n = wb.parseNew('P0 Ship it [after: task_abc, task_def] [skills: gpu] [budget: $3] [review]');
  assert.equal(n.title, 'Ship it');
  assert.equal(n.priority, 0);
  assert.deepEqual(n.dependsOn, ['task_abc', 'task_def']);
  assert.deepEqual(n.budget, { costUsd: 3 });
  assert.equal(n.review, true);
});

test('MCP: vendor detection, next_task, progress and review tools', () => {
  const s = tmpStore();
  assert.equal(vendorOf('codex-mcp-client'), 'OpenAI');
  assert.equal(vendorOf('gemini-cli'), 'Google');
  assert.equal(vendorOf('claude-code'), 'Anthropic');
  const call = (h, name, args) => {
    const res = h({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }).result;
    return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
  };
  const codex = createHandler({ store: s });
  codex({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex-mcp-client', version: '1.0' } } });
  const claude = createHandler({ store: s, agent: 'claude' });
  claude({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } });
  const agents = call(codex, 'list_agents', {});
  assert.equal(agents.find((a) => a.name === 'codex-mcp-client').vendor, 'OpenAI');
  assert.equal(agents.find((a) => a.name === 'claude').vendor, 'Anthropic');
  const t = call(claude, 'create_task', { title: 'Do it', review: true, criteria: ['works'] });
  const picked = call(codex, 'next_task', { claim: true });
  assert.equal(picked.task.id, t.id);
  assert.equal(call(codex, 'report_progress', { id: t.id, progress: 80, metrics: { tests: 41 } }).progress, 80);
  call(codex, 'check_criterion', { id: t.id, criterion: 1, done: true });
  call(codex, 'submit_for_review', { id: t.id, summary: 'all green' });
  assert.match(call(codex, 'review_task', { id: t.id, approve: true }).error, /own work/);
  assert.equal(call(claude, 'review_task', { id: t.id, approve: true }).status, 'done');
  const ev = call(claude, 'events', { since: 0 });
  assert.ok(ev.events.some((e) => e.action === 'task.approved'));
});

test('HTTP: scripts act as themselves, progress, next, events and SSE', async () => {
  const s = tmpStore();
  const { server, url } = await start({ store: s });
  try {
    const as = (agent) => ({ 'Content-Type': 'application/json', 'X-AgentHaven-Agent': agent });
    await fetch(`${url}api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Train', skills: ['gpu'] }) });
    await fetch(`${url}api/agents`, { method: 'POST', headers: as('trainer'), body: JSON.stringify({ kind: 'neural-network', skills: ['gpu'] }) });
    const next = await (await fetch(`${url}api/tasks/next`, { method: 'POST', headers: as('trainer'), body: '{}' })).json();
    assert.equal(next.task.assignee, 'trainer');
    const prog = await fetch(`${url}api/tasks/${next.task.id}/progress`, { method: 'POST', headers: as('trainer'), body: JSON.stringify({ progress: 30, metrics: { loss: 0.7 } }) });
    assert.equal(prog.status, 201);
    const foreign = await fetch(`${url}api/tasks/${next.task.id}/progress`, { method: 'POST', headers: as('intruder'), body: JSON.stringify({ progress: 90 }) });
    assert.equal(foreign.status, 409);
    assert.equal((await fetch(`${url}api/tasks/task_nope`)).status, 404);
    assert.equal((await fetch(`${url}api/stats`, { headers: { 'X-AgentHaven-Agent': 'bad name!' } })).status, 400);
    assert.equal((await fetch(`${url}api/tasks/${next.task.id}?version=1`, { method: 'DELETE', headers: as('x') })).status, 409);
    const ev = await (await fetch(`${url}api/events?since=0`)).json();
    assert.ok(ev.events.some((e) => e.action === 'task.progress' && e.actor === 'trainer'));
    const ctrl = new AbortController();
    const res = await fetch(`${url}api/stream`, { signal: ctrl.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body.getReader();
    const { value } = await reader.read();
    assert.match(Buffer.from(value).toString(), /event: change/);
    ctrl.abort();
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('HTTP: linking a folder shares the board as files', async () => {
  const s = tmpStore();
  const dir = tmpDir('ah-link-');
  const { server, url } = await start({ store: s });
  try {
    const json = { 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${url}api/workboard`, { method: 'POST', headers: json, body: JSON.stringify({ dir: 'relative/path' }) })).status, 400);
    const linked = await (await fetch(`${url}api/workboard`, { method: 'POST', headers: json, body: JSON.stringify({ dir }) })).json();
    assert.equal(linked.linked, true);
    assert.match(linked.instructions, /WORKBOARD\.md/);
    fs.appendFileSync(path.join(dir, wb.BOARD), 'aider: new Write the changelog\n');
    for (let i = 0; i < 40 && !s.listTasks().length; i++) await sleep(100);
    assert.equal(s.listTasks()[0]?.title, 'Write the changelog');
    assert.equal((await (await fetch(`${url}api/workboard`, { method: 'DELETE' })).json()).linked, false);
  } finally {
    server.close();
  }
});

test('connect: Gemini CLI (JSON) and Codex (TOML) keep their other settings', () => {
  const connect = require('../src/connect');
  const home = tmpDir('ah-home-');
  const opts = { home, platform: 'linux', env: {} };
  const entry = connect.serverEntry({ command: '/app', script: '/app/bin/agenthaven.js', agent: 'codex', extraEnv: { ELECTRON_RUN_AS_NODE: '1' } });
  const toml = connect.clients(opts).codex.file;
  fs.mkdirSync(path.dirname(toml), { recursive: true });
  fs.writeFileSync(toml, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');
  connect.install('codex', entry, opts);
  connect.install('codex', entry, opts);
  const text = fs.readFileSync(toml, 'utf8');
  assert.match(text, /^model = "gpt-5"/);
  assert.match(text, /\[mcp_servers\.other\]\ncommand = "x"/);
  assert.equal(text.match(/\[mcp_servers\.agenthaven\]/g).length, 1);
  assert.match(text, /args = \["\/app\/bin\/agenthaven.js", "mcp", "--agent", "codex", "--workspace", "default"\]/);
  assert.match(text, /env = \{ ELECTRON_RUN_AS_NODE = "1" \}/);
  connect.install('gemini', entry, opts);
  assert.ok(JSON.parse(fs.readFileSync(connect.clients(opts).gemini.file, 'utf8')).mcpServers.agenthaven);
});
