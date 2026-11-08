'use strict';
// AgentHaven agent plugin: a dependency-free MCP server over stdio
// (newline-delimited JSON-RPC 2.0). Works with any MCP client, from any
// vendor: Claude Desktop/Code, Codex, Gemini CLI, Cursor, VS Code/Copilot,
// Windsurf, Zed, local model runners, ...
const readline = require('node:readline');
const { Store, STATUSES, AGENT_KINDS } = require('./store');
const dreams = require('./dream');
const pkg = require('../package.json');

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const HEARTBEAT_EVERY_MS = 60000;

const str = (description) => ({ type: 'string', description });
const list = (description) => ({ type: 'array', items: { type: 'string' }, description });
const id = { id: str('Task id, e.g. task_3f9a1c2b4d5e') };
const taskFields = {
  description: str('Details: goal, context, constraints'),
  files: list('Files or folders this task touches. Other agents cannot claim overlapping work while it is active.'),
  priority: { type: 'integer', minimum: 0, maximum: 3, description: '0 = urgent, 1 = high, 2 = normal (default), 3 = low' },
  dependsOn: list('Task ids that must be done before this one can start'),
  skills: list('Skills an agent needs for this task, e.g. ["gpu", "python", "design"]'),
  criteria: list('Acceptance criteria. All must be checked before the task is done.'),
  review: { type: 'boolean', description: 'Require review by someone other than the agent who did the work' },
  budget: { type: 'object', properties: { costUsd: { type: 'number' }, tokens: { type: 'number' } }, description: 'Spending limit; the task is blocked when usage passes it' },
};

const TOOLS = [
  { name: 'next_task', description: 'Get the most important task you can start right now (priority, dependencies done, files free, your skills). Set claim=true to claim it in the same step. Start every session with this or list_tasks.',
    inputSchema: { type: 'object', properties: { claim: { type: 'boolean', description: 'Claim the task immediately (recommended)' } } },
    run: (s, a, actor) => withLessons(s, s.nextTask({ actor, claim: Boolean(a.claim) }), actor) },
  { name: 'list_tasks', description: 'List tasks on the shared board (compact). Shows who works on what, priorities and what each task waits on.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: STATUSES }, assignee: str('Filter by agent name') } },
    run: (s, a) => s.listTasks(a) },
  { name: 'get_task', description: 'Get one task in full: description, criteria, comments, handoff history, metrics, its version, and the lessons learned that apply to it. Read the lessons before you start.',
    inputSchema: { type: 'object', properties: id, required: ['id'] },
    run: (s, a, actor) => { const t = s.getTask(a.id); return { ...t, lessons: dreams.lessonsFor(s, t, { agent: actor }) }; } },
  { name: 'create_task', description: 'Add a task to the shared board. Split big work into tasks with dependsOn, list the files, and add acceptance criteria.',
    inputSchema: { type: 'object', properties: { title: str('Short, specific title'), ...taskFields }, required: ['title'] },
    run: (s, a, actor) => s.createTask({ ...a, actor }) },
  { name: 'claim_task', description: 'Claim a task. Fails when someone else holds it, its dependencies are not done, or another agent is working on its files. The claim expires after 30 minutes without activity from you.',
    inputSchema: { type: 'object', properties: id, required: ['id'] },
    run: (s, a, actor) => { const t = s.claimTask(a.id, { actor }); return { ...t, lessons: dreams.lessonsFor(s, t, { agent: actor }) }; } },
  { name: 'report_progress', description: 'Report progress on your task: percent, a short message, usage (tokens, cost in USD, added to the total) and metrics (e.g. loss, accuracy, tests passed). Renews your claim. Exceeding the task budget blocks it.',
    inputSchema: { type: 'object', properties: { ...id, progress: { type: 'number', minimum: 0, maximum: 100 }, message: str('What you are doing now'),
      usage: { type: 'object', properties: { tokens: { type: 'number' }, costUsd: { type: 'number' } } },
      metrics: { type: 'object', additionalProperties: { type: 'number' }, description: 'Numbers to chart, e.g. {"loss": 0.41, "accuracy": 0.87}' } }, required: ['id'] },
    run: (s, { id: tid, ...rest }, actor) => s.reportProgress(tid, { ...rest, actor }) },
  { name: 'check_criterion', description: 'Tick (or untick) an acceptance criterion of a task, by its id, its number (1-based) or its exact text.',
    inputSchema: { type: 'object', properties: { ...id, criterion: str('Criterion id, number or text'), done: { type: 'boolean' } }, required: ['id', 'criterion', 'done'] },
    run: (s, a, actor) => s.setCriterion(a.id, { actor, criterion: String(a.criterion), done: a.done }) },
  { name: 'update_task', description: 'Change a task you hold (or an unclaimed one). Pass the version you last read; on conflict, re-read and retry. Set status "done" only for tasks without review.',
    inputSchema: { type: 'object', properties: { ...id, version: { type: 'integer' }, title: { type: 'string' }, status: { type: 'string', enum: STATUSES }, assignee: { type: ['string', 'null'] }, blockedReason: str('Why the task is blocked'), ...taskFields }, required: ['id', 'version'] },
    run: (s, { id: tid, ...rest }, actor) => s.updateTask(tid, { ...rest, actor }) },
  { name: 'submit_for_review', description: 'Hand your finished work to review. Another agent or a human approves it or sends it back.',
    inputSchema: { type: 'object', properties: { ...id, summary: str('What you did and how you verified it') }, required: ['id', 'summary'] },
    run: (s, a, actor) => s.submitForReview(a.id, { actor, summary: a.summary }) },
  { name: 'review_task', description: 'Review someone else\'s task in review: approve (done) or send it back with what must change. You cannot review your own work.',
    inputSchema: { type: 'object', properties: { ...id, approve: { type: 'boolean' }, comment: str('Required when not approving') }, required: ['id', 'approve'] },
    run: (s, a, actor) => s.reviewTask(a.id, { actor, approve: a.approve, comment: a.comment }) },
  { name: 'handoff_task', description: 'Hand a task to another agent (or back to the board) with a summary of what was done and what is next. Use this when you stop, so the next agent can continue.',
    inputSchema: { type: 'object', properties: { ...id, to: str('Receiving agent; omit to return it to the board'), summary: str('What was done'), nextSteps: str('What should happen next') }, required: ['id', 'summary'] },
    run: (s, { id: tid, ...rest }, actor) => s.handoff(tid, { ...rest, actor }) },
  { name: 'comment_task', description: 'Ask or answer a question on a task. Use this to talk to the agent who holds it.',
    inputSchema: { type: 'object', properties: { ...id, body: { type: 'string' } }, required: ['id', 'body'] },
    run: (s, a, actor) => s.comment(a.id, { actor, body: a.body }) },
  { name: 'heartbeat', description: 'Tell the board you are still alive and renew your claims. Any other tool call also counts; use this during long work without other calls.',
    inputSchema: { type: 'object', properties: { status: str('Optional short status, e.g. "running the test suite"') } },
    run: (s, a, actor) => s.heartbeat({ actor, status: a.status }) },
  { name: 'register_agent', description: 'Describe yourself so tasks that need your skills reach you: kind, vendor, model and skills.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: AGENT_KINDS }, vendor: str('e.g. Anthropic, OpenAI, Google, local'), model: str('Model name'), skills: list('e.g. ["typescript", "review", "gpu"]'), description: str('What you are good at') } },
    run: (s, a, actor) => s.registerAgent({ ...a, actor }) },
  { name: 'list_agents', description: 'Who is on this board: kind, vendor, model, skills, presence (online, idle, offline) and current tasks.',
    inputSchema: { type: 'object', properties: {} },
    run: (s) => s.listAgents() },
  { name: 'file_claims', description: 'Show which files other agents are actively working on. Check before editing files; add files to your task so others see them.',
    inputSchema: { type: 'object', properties: {} },
    run: (s) => s.fileClaims() },
  { name: 'add_note', description: 'Save project knowledge (decisions, conventions, explanations) to shared memory.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: list('Tags') }, required: ['title', 'body'] },
    run: (s, a, actor) => s.addNote({ ...a, actor }) },
  { name: 'search_notes', description: 'Search shared project memory.',
    inputSchema: { type: 'object', properties: { query: str('Text to search for; omit for all notes') } },
    run: (s, a) => s.listNotes(a) },
  { name: 'events', description: 'What changed since your last look: pass the cursor you got last time (0 the first time). Cheap way to follow the board.',
    inputSchema: { type: 'object', properties: { since: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 } } },
    run: (s, a) => s.events(a) },
  { name: 'board_summary', description: 'Counts per status, spend, and agents online.',
    inputSchema: { type: 'object', properties: {} },
    run: (s) => s.stats() },
  { name: 'dream_digest', description: 'For the dreaming agent: everything since the last dream (reviews sent back and why, expired claims, budget overruns, stuck tasks, handoffs, comments, all notes, open proposals). Read it, look for patterns, then call submit_dream.',
    inputSchema: { type: 'object', properties: { since: { type: 'integer', minimum: 0, description: 'Event cursor; omit for "since the last dream"' } } },
    run: (s, a) => dreams.digest(s, a) },
  { name: 'submit_dream', description: 'For the dreaming agent: record what you learned as proposals. Kinds: lesson (title, body, scope {files, skills}), task (title, body, task {priority, files, skills}), merge-notes (notes: [ids], body = merged text), retire-note (note: id), agent-tip (agent, title, body). Add evidence: [task or note ids]. A human reviews them unless auto-apply is on.',
    inputSchema: { type: 'object', properties: { summary: str('What you noticed, in a few sentences'),
      proposals: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: dreams.KINDS }, title: { type: 'string' }, body: { type: 'string' },
        scope: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, skills: { type: 'array', items: { type: 'string' } } } },
        task: { type: 'object', properties: { priority: { type: 'integer' }, files: { type: 'array', items: { type: 'string' } }, skills: { type: 'array', items: { type: 'string' } } } },
        notes: { type: 'array', items: { type: 'string' } }, note: { type: 'string' }, agent: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'title', 'body'] } } },
      required: ['summary', 'proposals'] },
    run: (s, a, actor) => dreams.recordDream(s, { actor, summary: a.summary, proposals: a.proposals || [] }) },
  { name: 'list_dreams', description: 'Recent dreams and their proposals (proposed, applied or dismissed).',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    run: (s, a) => dreams.listDreams(s, a) },
  { name: 'delete_task', description: 'Delete a task (e.g. a duplicate). Pass the version you last read.',
    inputSchema: { type: 'object', properties: { ...id, version: { type: 'integer' } }, required: ['id', 'version'] },
    run: (s, a, actor) => s.deleteTask(a.id, { version: a.version, actor }) },
  { name: 'recent_activity', description: 'Show the latest activity log entries (who did what).',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
    run: (s, a) => s.activity(a) },
];

// The vendor behind a known MCP client, from its clientInfo name.
const VENDORS = [
  [/claude/i, 'Anthropic'], [/codex|openai|chatgpt/i, 'OpenAI'], [/gemini|google|jules/i, 'Google'],
  [/copilot|vscode|visual studio/i, 'GitHub'], [/cursor/i, 'Cursor'], [/windsurf|codeium/i, 'Windsurf'],
  [/zed/i, 'Zed'], [/cline|roo|kilo|continue|aider|goose|opencode/i, 'open source'], [/ollama|lm ?studio|llama|local/i, 'local'],
];
const vendorOf = (name = '') => VENDORS.find(([re]) => re.test(name))?.[1];

// Attaches the lessons learned that apply to a picked task.
function withLessons(store, res, actor) {
  if (res.task) res.task = { ...res.task, lessons: dreams.lessonsFor(store, res.task, { agent: actor }) };
  return res;
}

const INSTRUCTIONS = [
  'AgentHaven is a shared work board for all AI agents and people on this project, whatever their vendor.',
  'Start with next_task (claim=true) or list_tasks. Work only on tasks you have claimed, and list the files you touch on your task: claims fail when another agent is working on those files.',
  'Read the lessons that come with a task: they are mistakes earlier agents made here.',
  'Call report_progress while you work (with usage and metrics when you have them); a claim expires after 30 minutes of silence.',
  'Finish with submit_for_review (or update_task status "done" when no review is needed), or handoff_task with what you did and what is next. Read comments on your task; answer with comment_task.',
].join(' ');

function createHandler({ store = new Store({ workspace: process.env.AGENTHAVEN_WORKSPACE || 'default' }), agent = process.env.AGENTHAVEN_AGENT } = {}) {
  let actor = agent;
  let lastBeat = 0;
  const beat = () => {
    if (!actor || Date.now() - lastBeat < HEARTBEAT_EVERY_MS) return;
    lastBeat = Date.now();
    try { store.heartbeat({ actor }); } catch { /* presence is best effort */ }
  };
  return function handle(msg) {
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid Request');
    const isNotification = msg.id === undefined;
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params?.protocolVersion;
        const client = msg.params?.clientInfo || {};
        actor ||= client.name || 'agent';
        try {
          const known = store.read().agents[actor];
          if (!known || !known.vendor) store.registerAgent({ actor, vendor: vendorOf(`${client.name} ${actor}`), model: known?.model, kind: known?.kind || 'llm', description: client.version ? `${client.name} ${client.version}` : undefined });
          lastBeat = Date.now();
        } catch { /* presence is best effort */ }
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'agenthaven', version: pkg.version },
          instructions: `${INSTRUCTIONS} You appear on the board as "${actor}".`,
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
          if (tool.name !== 'heartbeat') beat();
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

module.exports = { createHandler, serve, TOOLS, vendorOf };
