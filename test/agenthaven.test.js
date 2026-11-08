'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { Store } = require('../src/store');
const { createHandler } = require('../src/mcp');
const { start } = require('../src/server');

const tmpStore = () => new Store({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ah-')) });

test('CLI version aliases print the package version', () => {
  const cli = path.join(__dirname, '..', 'bin', 'agenthaven.js');
  const { version } = require('../package.json');
  for (const arg of ['--version', '-v', 'version']) {
    const output = execFileSync(process.execPath, [cli, arg], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.equal(output.trim(), version, arg);
  }
});

test('tasks: create, claim, conflict-safe update, handoff, activity', () => {
  const s = tmpStore();
  const t = s.createTask({ title: 'Write docs', actor: 'claude' });
  assert.equal(t.status, 'todo');
  const claimed = s.claimTask(t.id, { actor: 'claude' });
  assert.equal(claimed.assignee, 'claude');
  assert.equal(claimed.status, 'doing');
  assert.throws(() => s.claimTask(t.id, { actor: 'cursor' }), { code: 'CONFLICT' });
  assert.throws(() => s.updateTask(t.id, { version: 1, status: 'review', actor: 'cursor' }), { code: 'CONFLICT' });
  assert.throws(() => s.updateTask(t.id, { status: 'review', actor: 'cursor' }), { code: 'INVALID' });
  const updated = s.updateTask(t.id, { version: claimed.version, status: 'review', actor: 'claude' });
  assert.equal(updated.version, claimed.version + 1);
  const handed = s.handoff(t.id, { actor: 'claude', to: 'cursor', summary: 'Draft done', nextSteps: 'Proofread' });
  assert.equal(handed.assignee, 'cursor');
  assert.equal(handed.handoffs[0].summary, 'Draft done');
  assert.deepEqual(s.activity().map((e) => e.action), ['task.handoff', 'task.updated', 'task.claimed', 'task.created']);
});

test('notes and validation', () => {
  const s = tmpStore();
  s.addNote({ title: 'Style', body: 'Use tabs', tags: ['conventions'], actor: 'codex' });
  assert.equal(s.listNotes({ query: 'TABS' }).length, 1);
  assert.equal(s.listNotes({ query: 'nope' }).length, 0);
  assert.throws(() => s.createTask({ title: '  ', actor: 'x' }), { code: 'INVALID' });
  assert.throws(() => new Store({ dataDir: os.tmpdir(), workspace: '../evil' }), { code: 'INVALID' });
});

test('two store instances share one workspace file', () => {
  const a = tmpStore();
  const b = new Store({ dataDir: a.dataDir });
  a.createTask({ title: 'From A', actor: 'a' });
  b.createTask({ title: 'From B', actor: 'b' });
  assert.deepEqual(a.listTasks().map((t) => t.title), ['From A', 'From B']);
});

test('MCP handler: initialize, list and call tools', () => {
  const h = createHandler({ store: tmpStore() });
  const init = h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const names = h({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools.map((t) => t.name);
  assert.ok(names.includes('claim_task') && names.includes('handoff_task'));
  const created = h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'Fix bug' } } });
  assert.equal(JSON.parse(created.result.content[0].text).createdBy, 'claude-code');
  const bad = h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'claim_task', arguments: { id: 'task_missing' } } });
  assert.equal(bad.result.isError, true);
  assert.equal(h({ jsonrpc: '2.0', id: 5, method: 'nope' }).error.code, -32601);
});

test('MCP plugin works end-to-end over stdio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'agenthaven.js'), 'mcp', '--agent', 'tester'], { env: { ...process.env, AGENTHAVEN_HOME: dir } });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...d.toString().trim().split('\n')));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'stdio' } } })}\n`);
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  const [init, call] = lines.map((l) => JSON.parse(l));
  assert.equal(init.result.serverInfo.name, 'agenthaven');
  assert.equal(JSON.parse(call.result.content[0].text).createdBy, 'tester');
});

test('HTTP API: CRUD, conflict status, host/origin protection, UI', async () => {
  const { server, url } = await start({ store: tmpStore() });
  try {
    const json = { 'Content-Type': 'application/json' };
    const created = await (await fetch(`${url}api/tasks`, { method: 'POST', headers: json, body: JSON.stringify({ title: 'UI task' }) })).json();
    assert.equal(created.createdBy, 'you');
    const ok = await fetch(`${url}api/tasks/${created.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ version: 1, status: 'done' }) });
    assert.equal(ok.status, 200);
    const stale = await fetch(`${url}api/tasks/${created.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ version: 1, status: 'todo' }) });
    assert.equal(stale.status, 409);
    const evil = await fetch(`${url}api/tasks`, { method: 'POST', headers: { ...json, Origin: 'https://evil.example' }, body: '{"title":"x"}' });
    assert.equal(evil.status, 403);
    const page = await fetch(url);
    assert.match(await page.text(), /AgentHaven/);
    assert.equal((await fetch(`${url}..%2fpackage.json`)).status, 404);
  } finally {
    server.close();
  }
});

test('Node progress example claims a task, reports metrics and submits for review', async () => {
  const { dataDir } = tmpStore();
  const workspace = 'training';
  const store = new Store({ dataDir, workspace });
  const task = store.createTask({ title: 'Train the demo model', actor: 'you' });
  const { server, url } = await start({ dataDir });
  try {
    const example = path.join(__dirname, '..', 'examples', 'report_progress.mjs');
    const { stdout } = await promisify(execFile)(process.execPath, [example], {
      env: { ...process.env, AGENTHAVEN_URL: url, AGENTHAVEN_AGENT: 'demo-trainer', AGENTHAVEN_WORKSPACE: workspace },
      timeout: 20_000,
    });
    assert.match(stdout, /Sent to review/);
    const result = store.getTask(task.id);
    assert.equal(result.assignee, 'demo-trainer');
    assert.equal(result.status, 'review');
    assert.equal(result.progress, 100);
    assert.equal(result.metrics.loss.length, 10);
    assert.equal(result.metrics.accuracy.length, 10);
    assert.match(result.verification, /completed all 10 epochs/);
  } finally {
    server.close();
  }
});

test('file claims: overlapping files block other agents, not the owner', () => {
  const s = tmpStore();
  const a = s.createTask({ title: 'Refactor', files: ['./src/', 'README.md'], actor: 'claude' });
  assert.deepEqual(a.files, ['src', 'README.md']);
  s.claimTask(a.id, { actor: 'claude' });
  const b = s.createTask({ title: 'Fix', files: ['src\\store.js'], actor: 'cursor' });
  assert.equal(b.files[0], 'src/store.js');
  assert.throws(() => s.claimTask(b.id, { actor: 'cursor' }), (err) => err.code === 'CONFLICT' && /claude/.test(err.message));
  s.handoff(a.id, { actor: 'claude', to: 'codex', summary: 'x' });
  assert.throws(() => s.claimTask(b.id, { actor: 'cursor' }), /codex/);
  const c = s.createTask({ title: 'Docs', files: ['docs/index.html'], actor: 'cursor' });
  assert.equal(s.claimTask(c.id, { actor: 'cursor' }).assignee, 'cursor');
  const claims = s.fileClaims();
  assert.ok(claims.some((x) => x.file === 'docs/index.html' && x.agent === 'cursor'));
  const fresh = s.getTask(c.id);
  assert.throws(() => s.updateTask(c.id, { version: fresh.version, files: ['src/x.js'], actor: 'cursor' }), { code: 'CONFLICT' });
});

test('delete task needs the current version', () => {
  const s = tmpStore();
  const t = s.createTask({ title: 'Dup', actor: 'a' });
  assert.throws(() => s.deleteTask(t.id, { version: 99, actor: 'a' }), { code: 'CONFLICT' });
  assert.deepEqual(s.deleteTask(t.id, { version: 1, actor: 'a' }), { deleted: t.id });
  assert.equal(s.listTasks().length, 0);
});

test('workspaces are isolated and listed', async () => {
  const s = tmpStore();
  const { server, url } = await start({ dataDir: s.dataDir });
  try {
    const json = { 'Content-Type': 'application/json' };
    await fetch(`${url}api/tasks?workspace=alpha`, { method: 'POST', headers: json, body: '{"title":"A"}' });
    assert.equal((await (await fetch(`${url}api/tasks?workspace=alpha`)).json()).length, 1);
    assert.equal((await (await fetch(`${url}api/tasks`)).json()).length, 0);
    assert.deepEqual(await (await fetch(`${url}api/workspaces`)).json(), ['alpha', 'default']);
    assert.equal((await fetch(`${url}api/tasks?workspace=..%2Fx`)).status, 400);
    const [task] = await (await fetch(`${url}api/tasks?workspace=alpha`)).json();
    assert.equal((await fetch(`${url}api/tasks/${task.id}?workspace=alpha&version=1`, { method: 'DELETE' })).status, 200);
  } finally {
    server.close();
  }
});

test('connect: merges into client config without losing settings, refuses broken JSON', () => {
  const connect = require('../src/connect');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-home-'));
  const opts = { home, platform: 'darwin', env: {} };
  const file = connect.clients(opts).claude.file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
  const entry = connect.serverEntry({ command: '/app', script: '/app/bin/agenthaven.js', agent: 'claude', extraEnv: { ELECTRON_RUN_AS_NODE: '1' } });
  connect.install('claude', entry, opts);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.theme, 'dark');
  assert.ok(cfg.mcpServers.other);
  assert.deepEqual(cfg.mcpServers.agenthaven.args, ['/app/bin/agenthaven.js', 'mcp', '--agent', 'claude', '--workspace', 'default']);
  assert.ok(fs.existsSync(`${file}.agenthaven-backup`));
  const cursor = connect.clients(opts).cursor.file;
  fs.mkdirSync(path.dirname(cursor), { recursive: true });
  fs.writeFileSync(cursor, '{ broken');
  assert.throws(() => connect.install('cursor', entry, opts), /not valid JSON/);
  assert.equal(fs.readFileSync(cursor, 'utf8'), '{ broken');
  assert.match(connect.clients({ home, platform: 'win32', env: { APPDATA: 'C:\\U\\AppData' } }).claude.file, /Claude/);
});
