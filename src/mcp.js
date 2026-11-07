'use strict';
// AgentHaven agent plugin: a dependency-free MCP server over stdio
// (newline-delimited JSON-RPC 2.0). Works with any MCP client
// (Claude Desktop/Code, Cursor, VS Code, Codex, ...).
const readline = require('node:readline');
const { Store, STATUSES } = require('./store');
const pkg = require('../package.json');

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const str = (description) => ({ type: 'string', description });
const TOOLS = [
  { name: 'list_tasks', description: 'List tasks on the shared board. Call this first to see what others are working on.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: STATUSES }, assignee: str('Filter by agent name') } },
    run: (s, a) => s.listTasks(a) },
  { name: 'get_task', description: 'Get one task including its version and handoff history.',
    inputSchema: { type: 'object', properties: { id: str('Task id') }, required: ['id'] },
    run: (s, a) => s.getTask(a.id) },
  { name: 'create_task', description: 'Add a task to the shared board.',
    inputSchema: { type: 'object', properties: { title: str('Short title'), description: str('Details'), files: { type: 'array', items: { type: 'string' }, description: 'Files this task touches' } }, required: ['title'] },
    run: (s, a, actor) => s.createTask({ ...a, actor }) },
  { name: 'claim_task', description: 'Claim a task so other agents know you are working on it. Fails if someone else holds it.',
    inputSchema: { type: 'object', properties: { id: str('Task id') }, required: ['id'] },
    run: (s, a, actor) => s.claimTask(a.id, { actor }) },
  { name: 'update_task', description: 'Update a task. Pass the version you last read; on conflict, re-read and retry.',
    inputSchema: { type: 'object', properties: { id: str('Task id'), version: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: STATUSES }, assignee: { type: ['string', 'null'] }, files: { type: 'array', items: { type: 'string' } } }, required: ['id', 'version'] },
    run: (s, { id, ...rest }, actor) => s.updateTask(id, { ...rest, actor }) },
  { name: 'handoff_task', description: 'Hand a task to another agent (or back to the board) with a summary of what was done and what is next.',
    inputSchema: { type: 'object', properties: { id: str('Task id'), to: str('Receiving agent; omit to return it to the board'), summary: str('What was done'), nextSteps: str('What should happen next') }, required: ['id', 'summary'] },
    run: (s, { id, ...rest }, actor) => s.handoff(id, { ...rest, actor }) },
  { name: 'add_note', description: 'Save project knowledge (decisions, conventions, explanations) to shared memory.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title', 'body'] },
    run: (s, a, actor) => s.addNote({ ...a, actor }) },
  { name: 'search_notes', description: 'Search shared project memory.',
    inputSchema: { type: 'object', properties: { query: str('Text to search for; omit for all notes') } },
    run: (s, a) => s.listNotes(a) },
  { name: 'file_claims', description: 'Show which files other agents are actively working on. Check before editing files; add files to your task so others see them.',
    inputSchema: { type: 'object', properties: {} },
    run: (s) => s.fileClaims() },
  { name: 'delete_task', description: 'Delete a task (e.g. a duplicate). Pass the version you last read.',
    inputSchema: { type: 'object', properties: { id: str('Task id'), version: { type: 'integer' } }, required: ['id', 'version'] },
    run: (s, a, actor) => s.deleteTask(a.id, { version: a.version, actor }) },
  { name: 'recent_activity', description: 'Show the latest activity log entries (who did what).',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
    run: (s, a) => s.activity(a) },
];

function createHandler({ store = new Store({ workspace: process.env.AGENTHAVEN_WORKSPACE || 'default' }), agent = process.env.AGENTHAVEN_AGENT } = {}) {
  let actor = agent;
  return function handle(msg) {
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid Request');
    const isNotification = msg.id === undefined;
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params?.protocolVersion;
        actor ||= msg.params?.clientInfo?.name || 'agent';
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'agenthaven', version: pkg.version },
          instructions: 'AgentHaven is a shared workspace with other AI agents. Check list_tasks before starting, list the files you will touch on your task, claim_task before working (it fails if another agent holds those files), and handoff_task with a summary when you stop.',
        });
      }
      case 'ping': return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === msg.params?.name);
        if (!tool) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
        try {
          const result = tool.run(store, msg.params.arguments || {}, actor || 'agent');
          return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
          return reply({ content: [{ type: 'text', text: `${err.code || 'ERROR'}: ${err.message}` }], isError: true });
        }
      }
      default:
        return isNotification ? null : fail(-32601, `Method not found: ${msg.method}`);
    }
  };
}

function serve({ input = process.stdin, output = process.stdout, ...opts } = {}) {
  const handle = createHandler(opts);
  const rl = readline.createInterface({ input });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let res;
    try { res = handle(JSON.parse(line)); } catch { res = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
    if (res) output.write(`${JSON.stringify(res)}\n`);
  });
  return rl;
}

module.exports = { createHandler, serve, TOOLS };
