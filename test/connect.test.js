'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const connect = require('../src/connect');
const { start } = require('../src/server');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function fakeHome() {
  const home = tmp('ah-conn-');
  const opts = { home, platform: 'darwin', env: {} };
  const app = path.join(home, 'AgentHaven.app');
  fs.mkdirSync(path.join(app, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(app, 'AgentHaven'), '');
  fs.writeFileSync(path.join(app, 'bin', 'agenthaven.js'), '');
  const entryFor = (agent) => connect.serverEntry({ command: path.join(app, 'AgentHaven'), script: path.join(app, 'bin', 'agenthaven.js'), agent, extraEnv: { ELECTRON_RUN_AS_NODE: '1' } });
  return { home, opts, app, entryFor, c: connect.clients(opts) };
}
const state = (list, id) => list.find((x) => x.id === id).state;

test('detect: only apps that are installed count, nothing is written by detecting', () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.dirname(c.cursor.file), { recursive: true });
  fs.mkdirSync(path.join(opts.home, '.codex'), { recursive: true });
  const list = connect.detect({ entryFor, ...opts });
  assert.equal(state(list, 'cursor'), 'not-connected');
  assert.equal(state(list, 'codex'), 'not-connected');
  assert.equal(state(list, 'claude'), 'not-installed');
  assert.equal(fs.existsSync(c.cursor.file), false);
});

test('autoConnect: connects every installed app, then has nothing left to do', () => {
  const { opts, entryFor, c } = fakeHome();
  for (const dir of [path.join(opts.home, '.cursor'), path.join(opts.home, '.gemini'), path.join(opts.home, '.codex'), path.join(opts.home, 'Library', 'Application Support', 'Code', 'User'), path.join(opts.home, '.lmstudio')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(c.gemini.file, JSON.stringify({ theme: 'x' }));
  const r = connect.autoConnect({ entryFor, ...opts });
  assert.deepEqual(r.map((x) => x.id).sort(), ['codex', 'cursor', 'gemini', 'lmstudio', 'vscode']);
  assert.ok(r.every((x) => x.action === 'connected'));
  assert.equal(JSON.parse(fs.readFileSync(c.gemini.file, 'utf8')).theme, 'x');
  const vs = JSON.parse(fs.readFileSync(c.vscode.file, 'utf8'));
  assert.equal(vs.servers.agenthaven.type, 'stdio', 'VS Code uses "servers" with a type');
  assert.deepEqual(vs.servers.agenthaven.args.slice(1, 4), ['mcp', '--agent', 'copilot']);
  assert.deepEqual(connect.autoConnect({ entryFor, ...opts }), []);
  assert.ok(connect.detect({ entryFor, ...opts }).filter((x) => x.installed).every((x) => x.state === 'connected'));
});

test('repair: an entry that points to a moved or old app is outdated and gets fixed', () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.dirname(c.cursor.file), { recursive: true });
  fs.writeFileSync(c.cursor.file, JSON.stringify({ mcpServers: { agenthaven: { command: '/Volumes/AgentHaven/AgentHaven.app/Contents/MacOS/AgentHaven', args: ['/Volumes/x/agenthaven.js', 'mcp'] }, other: { command: 'y' } } }));
  assert.equal(state(connect.detect({ entryFor, ...opts }), 'cursor'), 'outdated');
  const r = connect.autoConnect({ entryFor, ...opts });
  assert.deepEqual(r, [{ id: 'cursor', label: 'Cursor', action: 'repaired' }]);
  const cfg = JSON.parse(fs.readFileSync(c.cursor.file, 'utf8'));
  assert.equal(cfg.mcpServers.agenthaven.command, entryFor('cursor').command);
  assert.ok(cfg.mcpServers.other);
  assert.equal(state(connect.detect({ entryFor, ...opts }), 'cursor'), 'connected');
});

test('codex TOML: detect, repair and uninstall keep the rest of the file', () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.dirname(c.codex.file), { recursive: true });
  fs.writeFileSync(c.codex.file, 'model = "gpt-5"\n\n[mcp_servers.agenthaven]\ncommand = "/gone/node"\nargs = ["/gone/agenthaven.js", "mcp"]\n\n[mcp_servers.other]\ncommand = "x"\n');
  assert.equal(state(connect.detect({ entryFor, ...opts }), 'codex'), 'outdated');
  connect.autoConnect({ entryFor, ...opts });
  assert.equal(state(connect.detect({ entryFor, ...opts }), 'codex'), 'connected');
  connect.uninstall('codex', opts);
  const text = fs.readFileSync(c.codex.file, 'utf8');
  assert.doesNotMatch(text, /agenthaven\]/);
  assert.match(text, /^model = "gpt-5"/);
  assert.match(text, /\[mcp_servers\.other\]\ncommand = "x"/);
});

test('claude code: the plugin counts as connected, so tools are not added twice', () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.dirname(c['claude-code'].plugins), { recursive: true });
  fs.writeFileSync(c['claude-code'].plugins, JSON.stringify({ plugins: { 'agenthaven@agenthaven': [{}] } }));
  fs.writeFileSync(c['claude-code'].file, JSON.stringify({ numStartups: 3 }));
  const withNode = { ...opts, hasNode: true };
  assert.equal(state(connect.detect({ entryFor, ...withNode }), 'claude-code'), 'plugin');
  assert.deepEqual(connect.autoConnect({ entryFor, ...withNode }).filter((x) => x.id === 'claude-code'), []);
  fs.rmSync(c['claude-code'].plugins);
  connect.autoConnect({ entryFor, ...opts });
  const cfg = JSON.parse(fs.readFileSync(c['claude-code'].file, 'utf8'));
  assert.equal(cfg.numStartups, 3);
  assert.ok(cfg.mcpServers.agenthaven);
});

test('broken JSON is reported, never overwritten', () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.dirname(c.cursor.file), { recursive: true });
  fs.writeFileSync(c.cursor.file, '{ nope');
  assert.equal(state(connect.detect({ entryFor, ...opts }), 'cursor'), 'broken-config');
  assert.deepEqual(connect.autoConnect({ entryFor, ...opts }), []);
  assert.equal(fs.readFileSync(c.cursor.file, 'utf8'), '{ nope');
});

test('HTTP: auto-connect at start, disconnect is remembered, agents may not change connections', async () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.join(opts.home, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(opts.home, '.gemini'), { recursive: true });
  const dataDir = tmp('ah-conn-data-');
  const { server, url } = await start({ dataDir, dream: false, connections: { entryFor, auto: true, clientOpts: opts } });
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(new URL(p, url), { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    let r = await call('GET', '/api/connections');
    assert.equal(r.status, 200);
    assert.equal(r.body.managed, true);
    assert.deepEqual(r.body.lastAuto.results.map((x) => x.id).sort(), ['cursor', 'gemini']);
    assert.equal(state(r.body.clients, 'cursor'), 'connected');

    r = await call('DELETE', '/api/connections/cursor', null, { 'X-AgentHaven-Agent': 'codex' });
    assert.equal(r.status, 400, 'an agent cannot disconnect apps');
    r = await call('DELETE', '/api/connections/cursor');
    assert.equal(state(r.body.clients, 'cursor'), 'not-connected');
    assert.deepEqual(r.body.off, ['cursor']);
    assert.equal(JSON.parse(fs.readFileSync(c.cursor.file, 'utf8')).mcpServers.agenthaven, undefined);

    r = await call('PATCH', '/api/connections', { auto: true });
    assert.equal(state(r.body.clients, 'cursor'), 'not-connected', 'a disconnected app stays disconnected');

    r = await call('POST', '/api/connections', { client: 'cursor' });
    assert.equal(r.status, 201);
    assert.equal(state(r.body.clients, 'cursor'), 'connected');
    assert.deepEqual(r.body.off, []);

    r = await call('POST', '/api/connections', { client: 'nope' });
    assert.equal(r.status, 404);

    r = await call('PATCH', '/api/connections', { auto: false });
    assert.equal(r.body.auto, false);
  } finally {
    server.close();
  }
});

test('JSON with comments and trailing commas (VS Code, Cursor) can be connected', () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.dirname(c.vscode.file), { recursive: true });
  fs.writeFileSync(c.vscode.file, '{\n  // my servers\n  "servers": { "web": { "url": "https://a//b", }, },\n  /* done */\n}\n');
  assert.equal(state(connect.detect({ entryFor, ...opts }), 'vscode'), 'not-connected');
  connect.autoConnect({ entryFor, ...opts });
  const cfg = JSON.parse(fs.readFileSync(c.vscode.file, 'utf8'));
  assert.equal(cfg.servers.web.url, 'https://a//b', 'slashes inside strings are kept');
  assert.ok(cfg.servers.agenthaven);
  assert.match(fs.readFileSync(`${c.vscode.file}.agenthaven-backup`, 'utf8'), /my servers/, 'the original with comments is kept as backup');
});

test('npx: the entry starts AgentHaven through npx, not from its cache folder', () => {
  const e = connect.nodeEntryFor('codex', 'default', { dir: '/home/u/.npm/_npx/abc/node_modules/agenthaven/src', platform: 'linux' });
  assert.equal(e.command, 'npx');
  assert.deepEqual(e.args.slice(0, 4), ['-y', 'github:laaielichter/AgentHaven', 'mcp', '--agent']);
  assert.equal(connect.nodeEntryFor('codex', 'default', { dir: 'C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\abc\\src', platform: 'win32' }).command, 'cmd');
  assert.equal(connect.nodeEntryFor('codex').command, process.execPath);
});

test('claude code plugin without Node.js: the app connects Claude Code, and removes that again once Node.js is there', () => {
  const { opts, entryFor, c } = fakeHome();
  fs.mkdirSync(path.dirname(c['claude-code'].plugins), { recursive: true });
  fs.writeFileSync(c['claude-code'].plugins, JSON.stringify({ plugins: { 'agenthaven@agenthaven': [{}] } }));
  const noNode = { ...opts, hasNode: false };
  const before = connect.detect({ entryFor, ...noNode }).find((x) => x.id === 'claude-code');
  assert.equal(before.state, 'not-connected');
  assert.match(before.reason, /needs Node\.js/);
  assert.deepEqual(connect.autoConnect({ entryFor, ...noNode }).map((x) => [x.id, x.action]), [['claude-code', 'connected']]);
  assert.equal(state(connect.detect({ entryFor, ...noNode }), 'claude-code'), 'connected');
  const withNode = { ...opts, hasNode: true };
  assert.deepEqual(connect.autoConnect({ entryFor, ...withNode }).map((x) => [x.id, x.action]), [['claude-code', 'deduplicated']]);
  assert.equal(JSON.parse(fs.readFileSync(c['claude-code'].file, 'utf8')).mcpServers.agenthaven, undefined);
  assert.equal(state(connect.detect({ entryFor, ...withNode }), 'claude-code'), 'plugin');
});

test('hasNode finds node in PATH and in the usual folders', () => {
  const home = tmp('ah-node-');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  assert.equal(connect.hasNode({ platform: 'linux', env: { PATH: bin }, home, shell: false }), fs.existsSync('/usr/bin/node') || fs.existsSync('/usr/local/bin/node') || fs.existsSync('/opt/homebrew/bin/node'));
  fs.writeFileSync(path.join(bin, 'node'), '');
  assert.equal(connect.hasNode({ platform: 'linux', env: { PATH: bin }, home, shell: false }), true);
  fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', 'v22.0.0'), { recursive: true });
  assert.equal(connect.hasNode({ platform: 'linux', env: { PATH: '' }, home, shell: false }), true);
});

test('plugin launcher: Node.js first, then the desktop app runtime; hooks fail open without either', { skip: process.platform === 'win32' }, () => {
  const { execFileSync, spawnSync } = require('node:child_process');
  const run = path.join(__dirname, '..', 'claude', 'run.sh');
  const pkg = require('../package.json');
  assert.equal(execFileSync('sh', [run, '--version'], { encoding: 'utf8' }).trim(), pkg.version);
  // No node on PATH: use the runtime the desktop app wrote (here: this Node binary).
  const dir = tmp('ah-rt-');
  const file = path.join(dir, 'runtime');
  fs.writeFileSync(file, `${process.execPath}\r\n`);
  const env = { PATH: '/nonexistent', HOME: dir, AGENTHAVEN_RUNTIME_FILE: file };
  const shPath = ['/bin/sh', '/usr/bin/sh'].find((p) => fs.existsSync(p));
  const sedOk = ['/bin/sed', '/usr/bin/sed'].some((p) => fs.existsSync(p));
  if (sedOk) {
    // sed, tr and dirname are needed by the launcher; give it a PATH with only those.
    const tools = tmp('ah-tools-');
    for (const t of ['sed', 'tr', 'dirname']) {
      const at = ['/bin', '/usr/bin'].map((d) => path.join(d, t)).find((p) => fs.existsSync(p));
      if (at) fs.symlinkSync(at, path.join(tools, t));
    }
    env.PATH = tools;
    assert.equal(execFileSync(shPath, [run, '--version'], { encoding: 'utf8', env }).trim(), pkg.version);
    fs.rmSync(file);
    const hook = spawnSync(shPath, [run, 'hook', 'session-start'], { encoding: 'utf8', env, input: '{}' });
    assert.equal(hook.status, 0, 'hooks fail open');
    const mcp = spawnSync(shPath, [run, 'mcp'], { encoding: 'utf8', env });
    assert.equal(mcp.status, 1);
    assert.match(mcp.stderr, /needs Node\.js 20 or later, or the AgentHaven desktop app/);
  }
});
