'use strict';
// The agent plugin: tool profiles, annotations, compact and structured output,
// prompts, one board name per session, and the editor hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Store } = require('../src/store');
const { createHandler, TOOLS, PROFILES } = require('../src/mcp');
const hooks = require('../src/hooks');
const commands = require('../scripts/claude-commands');
const pkg = require('../package.json');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ah-'));
const tmpStore = () => new Store({ dataDir: tmpDir() });
const rpc = (h, method, params, id = 1) => h({ jsonrpc: '2.0', id, method, params });
const init = (h, protocolVersion = '2025-06-18', name = 'claude-code') => rpc(h, 'initialize', { protocolVersion, clientInfo: { name } }).result;
const listTools = (h) => rpc(h, 'tools/list').result.tools;
const call = (h, name, args = {}) => {
  const r = rpc(h, 'tools/call', { name, arguments: args }).result;
  return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text);
};

test('tool profiles: core by default, more on demand with a list_changed notice', () => {
  const s = tmpStore();
  const sent = [];
  const h = createHandler({ store: s, agent: 'claude', notify: (m) => sent.push(m) });
  const initRes = init(h);
  assert.deepEqual(initRes.capabilities.tools, { listChanged: true });
  const core = listTools(h).map((t) => t.name);
  assert.deepEqual(new Set(core), new Set(PROFILES.core));
  assert.ok(core.length < TOOLS.length / 2 + 2, `core has ${core.length} of ${TOOLS.length} tools`);
  assert.ok(!core.includes('review_task') && !core.includes('dream_digest'));

  const res = call(h, 'enable_tools', { profiles: ['review', 'dream'] });
  assert.ok(res.tools.includes('review_task') && res.tools.includes('dream_digest'));
  assert.deepEqual(sent, [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }]);
  assert.ok(listTools(h).some((t) => t.name === 'submit_dream'));
  call(h, 'enable_tools', { profiles: ['review'] });
  assert.equal(sent.length, 1, 'no notice when nothing changed');
  assert.match(call(h, 'enable_tools', { profiles: ['nope'] }).error, /Unknown tool profile: nope/);

  // A tool outside the profile still works when called by name.
  assert.ok(Array.isArray(call(h, 'list_agents')));
  assert.equal(listTools(createHandler({ store: s, tools: 'all' })).length, TOOLS.length);
  assert.ok(listTools(createHandler({ store: s, tools: 'code,lead' })).some((t) => t.name === 'set_goal'));
  assert.throws(() => createHandler({ store: s, tools: 'everything' }), /Unknown tool profile/);
});

test('tool profiles follow the role: lead, skills and a configured repository', () => {
  const s = tmpStore();
  s.registerAgent({ actor: 'gemini', skills: ['review'] });
  s.takeLead({ actor: 'you', agent: 'gemini' });
  const h = createHandler({ store: s, agent: 'gemini' });
  init(h);
  const names = listTools(h).map((t) => t.name);
  assert.ok(names.includes('review_task'), 'review skill');
  assert.ok(names.includes('set_goal') && names.includes('resolve_escalation'), 'lead');
  assert.ok(!names.includes('dream_digest'));
});

test('annotations tell clients which tools only read and which delete', () => {
  const h = createHandler({ store: tmpStore(), tools: 'all' });
  const byName = Object.fromEntries(listTools(h).map((t) => [t.name, t.annotations]));
  assert.equal(byName.list_tasks.readOnlyHint, true);
  assert.equal(byName.get_context.readOnlyHint, true);
  assert.equal(byName.claim_task.readOnlyHint, false);
  assert.equal(byName.delete_task.destructiveHint, true);
  assert.equal(byName.update_task.destructiveHint, false);
  assert.equal(byName.next_task.title, 'Next task');
  for (const a of Object.values(byName)) assert.equal(a.openWorldHint, false);
});

test('results are compact JSON, plus structuredContent from protocol 2025-06-18', () => {
  const s = tmpStore();
  const modern = createHandler({ store: s, agent: 'a' });
  init(modern, '2025-06-18');
  const r = rpc(modern, 'tools/call', { name: 'create_task', arguments: { title: 'Compact', criteria: ['one'] } }).result;
  assert.ok(!r.content[0].text.includes('\n'), 'no indentation');
  assert.equal(r.structuredContent.title, 'Compact');
  const listed = rpc(modern, 'tools/call', { name: 'list_tasks', arguments: {} }).result;
  assert.equal(listed.structuredContent.result[0].title, 'Compact', 'arrays are wrapped in an object');

  const old = createHandler({ store: s, agent: 'b' });
  init(old, '2024-11-05');
  const r2 = rpc(old, 'tools/call', { name: 'list_tasks', arguments: {} }).result;
  assert.equal(r2.structuredContent, undefined);
  assert.equal(JSON.parse(r2.content[0].text)[0].title, 'Compact');
});

test('prompts: listed, filled in, and required arguments enforced', () => {
  const h = createHandler({ store: tmpStore() });
  assert.deepEqual(init(h).capabilities.prompts, {});
  const names = rpc(h, 'prompts/list').result.prompts.map((p) => p.name);
  assert.deepEqual(names, ['next', 'handoff', 'review', 'status', 'plan', 'dream']);
  const next = rpc(h, 'prompts/get', { name: 'next' }).result;
  assert.equal(next.messages[0].role, 'user');
  assert.match(next.messages[0].content.text, /next_task with claim=true/);
  assert.match(rpc(h, 'prompts/get', { name: 'plan', arguments: { goal: 'Ship checkout' } }).result.messages[0].content.text, /Goal: Ship checkout/);
  assert.match(rpc(h, 'prompts/get', { name: 'handoff', arguments: { to: 'skill:python' } }).result.messages[0].content.text, /to "skill:python"/);
  assert.match(rpc(h, 'prompts/get', { name: 'plan', arguments: {} }).error.message, /Missing argument: goal/);
  assert.equal(rpc(h, 'prompts/get', { name: 'nope' }).error.code, -32602);
  assert.match(rpc(h, 'prompts/get', { name: 'dream' }).result.messages[0].content.text, /enable_tools/);
});

test('two sessions with the same name get their own board names and claims', () => {
  const s = tmpStore();
  const one = createHandler({ store: s, agent: 'claude', cwd: '/work/a' });
  const two = createHandler({ store: s, agent: 'claude', cwd: '/work/b' });
  assert.match(init(one).instructions, /as "claude"\./);
  assert.match(init(two).instructions, /as "claude#2"\./);
  const t1 = s.createTask({ title: 'One', files: ['src/a.js'], actor: 'you' });
  const t2 = s.createTask({ title: 'Two', files: ['src/a.js'], actor: 'you' });
  assert.equal(call(one, 'claim_task', { id: t1.id }).assignee, 'claude');
  assert.match(call(two, 'claim_task', { id: t2.id }).error, /claude/, 'the second session cannot take the same files');
  assert.ok(!JSON.stringify(s.listAgents()).includes('session'), 'session ids stay private');

  one.close();
  const three = createHandler({ store: s, agent: 'claude' });
  assert.match(init(three).instructions, /as "claude"\./, 'a closed session frees its name');
  assert.equal(s.sessions().find((x) => x.name === 'claude#2').base, 'claude');
});

test('stdio plugin frees its board name when the client disconnects', async () => {
  const dir = tmpDir();
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'agenthaven.js'), 'mcp', '--agent', 'cc'], { env: { ...process.env, AGENTHAVEN_HOME: dir } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    child.on('close', () => resolve(JSON.parse(out.trim().split('\n')[0])));
  });
  assert.match((await run()).result.instructions, /as "cc"\./);
  assert.match((await run()).result.instructions, /as "cc"\./, 'not cc#2: the first session released it');
});

test('stdio plugin frees its board name when the client stops it with a signal', { skip: process.platform === 'win32' && 'Windows has no catchable SIGTERM' }, async () => {
  const dir = tmpDir();
  const start = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'agenthaven.js'), 'mcp', '--agent', 'cc'], { env: { ...process.env, AGENTHAVEN_HOME: dir } });
    child.stdout.once('data', (d) => resolve({ child, init: JSON.parse(d.toString().trim().split('\n')[0]) }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  });
  const children = [];
  try {
    const first = await start();
    children.push(first.child);
    assert.match(first.init.result.instructions, /as "cc"\./);
    await new Promise((resolve) => { first.child.on('close', resolve); first.child.kill('SIGTERM'); });
    const second = await start();
    children.push(second.child);
    assert.match(second.init.result.instructions, /as "cc"\./, 'not cc#2: SIGTERM released the name');
  } finally {
    for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  }
});

// ---- editor hooks ---------------------------------------------------------

function boardWithClaim() {
  const s = tmpStore();
  const project = tmpDir();
  const codex = createHandler({ store: s, agent: 'codex', cwd: project });
  init(codex, '2025-06-18', 'codex');
  const t = s.createTask({ title: 'Payments retry', files: ['src/payments/'], actor: 'you' });
  call(codex, 'claim_task', { id: t.id });
  const claude = createHandler({ store: s, agent: 'claude-code', cwd: project });
  init(claude);
  return { s, project, t, claude };
}

test('pre-tool-use hook refuses edits to files another agent claimed', () => {
  const { s, project, t, claude } = boardWithClaim();
  const edit = (file, tool = 'Edit') => hooks.preToolUse(s, { tool_name: tool, tool_input: { file_path: path.join(project, file) }, cwd: project }, { agent: 'claude-code' });
  const denied = edit('src/payments/retry.js');
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, new RegExp(`codex is working on src/payments.*${t.id}`));
  assert.equal(edit('src/payments/retry.js', 'Write').hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(edit('src/other.js'), null, 'unclaimed file');
  assert.equal(edit('src/payments/retry.js', 'Read'), null, 'reading is fine');
  assert.equal(hooks.preToolUse(s, { tool_name: 'Edit', tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere.js') }, cwd: project }, { agent: 'claude-code' }), null, 'outside the project');

  // Your own claim does not block you.
  const own = s.createTask({ title: 'Docs', files: ['docs/'], actor: 'you' });
  call(claude, 'claim_task', { id: own.id });
  assert.equal(edit('docs/guide.md'), null);
  // Once codex is done, the file is free.
  s.updateTask(t.id, { actor: 'codex', version: s.getTask(t.id).version, status: 'done' });
  assert.equal(edit('src/payments/retry.js'), null);
});

test('session-start hook briefs the agent; stop hook asks once before going quiet', () => {
  const { s, project, claude } = boardWithClaim();
  s.setGoal({ actor: 'you', text: 'Ship checkout', doneWhen: 'payments work' });
  s.createTask({ title: 'Write the FAQ', actor: 'you' });
  const brief = hooks.sessionStart(s, { cwd: project }, { agent: 'claude-code' }).hookSpecificOutput;
  assert.equal(brief.hookEventName, 'SessionStart');
  assert.match(brief.additionalContext, /Goal: Ship checkout/);
  assert.match(brief.additionalContext, /Up next: task_\w+ P2 "Write the FAQ"/);
  assert.match(brief.additionalContext, /src\/payments \(codex\)/);

  const mine = s.createTask({ title: 'Mine', actor: 'you' });
  call(claude, 'claim_task', { id: mine.id });
  assert.equal(hooks.stop(s, { cwd: project }, { agent: 'claude-code' }), null, 'fresh claim: no nudge');
  // Pretend the agent went quiet: its lease runs out in 5 minutes.
  s.withLock((d) => { d.tasks.find((x) => x.id === mine.id).leaseUntil = new Date(Date.now() + 5 * 60000).toISOString(); });
  const nudge = hooks.stop(s, { cwd: project }, { agent: 'claude-code' });
  assert.equal(nudge.decision, 'block');
  assert.match(nudge.reason, /report_progress.*handoff_task/);
  assert.equal(hooks.stop(s, { cwd: project, stop_hook_active: true }, { agent: 'claude-code' }), null, 'never loops');
});

test('hook command: answers over stdio and fails open on bad input', async () => {
  const dir = tmpDir();
  const project = tmpDir();
  const s = new Store({ dataDir: dir });
  const t = s.createTask({ title: 'Lock', files: ['a.js'], actor: 'you' });
  s.claimTask(t.id, { actor: 'codex' });
  const hook = (event, stdin) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'agenthaven.js'), 'hook', event, '--agent', 'claude-code'], { env: { ...process.env, AGENTHAVEN_HOME: dir } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    child.stdin.end(stdin);
  });
  const denied = await hook('pre-tool-use', JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(project, 'a.js') }, cwd: project }));
  assert.equal(denied.code, 0);
  assert.equal(JSON.parse(denied.out).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(await hook('pre-tool-use', 'not json'), { code: 0, out: '' });
  assert.deepEqual(await hook('unknown-event', '{}'), { code: 0, out: '' });
});

// ---- the Claude Code plugin -------------------------------------------------

test('Claude Code plugin: commands match the prompts, manifests match the package', () => {
  for (const [name, text] of Object.entries(commands.files())) {
    // Git on Windows may check the files out with CRLF line endings; compare the text.
    assert.equal(fs.readFileSync(path.join(commands.DIR, name), 'utf8').replace(/\r\n/g, '\n'), text, `${name} is stale: run node scripts/claude-commands.js`);
  }
  const root = path.join(__dirname, '..');
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(plugin.version, pkg.version);
  assert.equal(market.plugins[0].version, pkg.version);
  const hooksJson = JSON.parse(fs.readFileSync(path.join(root, plugin.hooks), 'utf8'));
  for (const event of ['SessionStart', 'PreToolUse', 'Stop']) {
    const cmd = hooksJson.hooks[event][0].hooks[0].command;
    assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/agenthaven\.js" hook /);
    assert.ok(hooks.HOOKS[cmd.split(' hook ')[1].split(' ')[0]], `${event} runs a known hook`);
  }
  const mcp = JSON.parse(fs.readFileSync(path.join(root, plugin.mcpServers), 'utf8'));
  assert.deepEqual(mcp.mcpServers.agenthaven.args.slice(1), ['mcp', '--agent', 'claude-code']);
});
