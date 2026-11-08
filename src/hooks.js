'use strict';
// Hooks for editor agents (the Claude Code plugin; any client with the same
// hook shape). They run as short separate processes, read the hook input as
// JSON on stdin and answer on stdout. Every hook fails open: if AgentHaven
// cannot answer, the editor carries on as if the hook were not there.
//
// - session-start: puts the goal, your inbox, the next tasks and the files in
//   use into the new session's context, so the agent starts informed.
// - pre-tool-use: refuses edits to files another agent has claimed. This is
//   what makes file claims binding instead of advice.
// - stop: before the agent ends its turn holding a task it has gone quiet on,
//   asks it once to report progress or hand the task off.
const path = require('node:path');
const { ACTIVE, overlaps, normFile } = require('./store');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const NUDGE_WHEN_LEASE_BELOW_MS = 20 * 60000;

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const related = (a, b) => Boolean(a && b) && (samePath(path.resolve(a), path.resolve(b)) || inside(a, b) || inside(b, a));

// Which board names are "me" for this editor session. The MCP plugin records
// the folder each session runs in; the hook matches on the agent name and that
// folder. Two sessions of one agent in the same folder cannot be told apart,
// so both count as "me": they are not blocked from each other's files.
function selves(store, { agent, cwd }) {
  const mine = store.sessions().filter((s) => s.base === agent || s.name === agent);
  const here = mine.filter((s) => related(s.cwd, cwd));
  const names = new Set((here.length ? here : mine).map((s) => s.name));
  names.add(agent);
  return names;
}

// The file as the board names it: relative to the repository, a task's
// worktree or the project folder, whichever contains it.
function boardPath(store, file, { cwd, projectDir }) {
  const abs = path.resolve(cwd || '.', file);
  const roots = [];
  for (const t of store.listTasks({ full: true })) if (t.worktree?.path) roots.push(t.worktree.path);
  const repo = store.getSettings().repo;
  if (repo?.path) roots.push(repo.path);
  if (projectDir) roots.push(projectDir);
  if (cwd) roots.push(cwd);
  const root = roots.find((r) => inside(abs, path.resolve(r)));
  return root ? normFile(path.relative(path.resolve(root), abs)) : null;
}

function preToolUse(store, input = {}, { agent = 'claude-code', projectDir } = {}) {
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!file) return null;
  const rel = boardPath(store, file, { cwd: input.cwd, projectDir });
  if (!rel) return null;
  const me = selves(store, { agent, cwd: input.cwd });
  const claim = store.fileClaims().find((c) => !me.has(c.agent) && overlaps(rel, normFile(c.file)));
  if (!claim) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `AgentHaven: ${claim.agent} is working on ${claim.file} (task ${claim.task} "${claim.title}", ${claim.status}). `
        + 'Do not edit it. Pick other work with next_task, ask them with send_message or comment_task, or wait until their task is done.',
    },
  };
}

function sessionStart(store, input = {}, { agent = 'claude-code' } = {}) {
  const stats = store.stats();
  const lines = ['AgentHaven: this project has a shared work board for AI agents and people. Use the agenthaven tools.'];
  if (stats.goal) lines.push(`Goal: ${stats.goal.text}${stats.goal.doneWhen ? ` (done when: ${stats.goal.doneWhen})` : ''}`);
  const c = stats.counts;
  lines.push(`Board: ${c.todo} to do, ${c.doing} doing, ${c.blocked} blocked, ${c.review} in review, ${c.done} done.`);
  const me = selves(store, { agent, cwd: input.cwd });
  const mine = store.listTasks({}).filter((t) => me.has(t.assignee) && ACTIVE.includes(t.status));
  if (mine.length) lines.push(`You hold: ${mine.map((t) => `${t.id} "${t.title}" (${t.status})`).join('; ')}. Continue it, or hand it off with handoff_task.`);
  const ready = store.listTasks({ status: 'todo' }).filter((t) => !t.waitingOn.length && !t.children).sort((x, y) => x.priority - y.priority).slice(0, 3);
  if (ready.length) lines.push(`Up next: ${ready.map((t) => `${t.id} P${t.priority} "${t.title}"`).join('; ')}.`);
  const claims = store.fileClaims().filter((cl) => !me.has(cl.agent));
  if (claims.length) lines.push(`Files in use by others (do not edit): ${claims.slice(0, 12).map((cl) => `${cl.file} (${cl.agent})`).join(', ')}${claims.length > 12 ? ', …' : ''}.`);
  if (stats.openQuestions) lines.push(`${stats.openQuestions} open question(s) on the board.`);
  if (stats.complete) lines.push('Every task is done.');
  lines.push(stats.total ? 'Start with inbox, then next_task with claim=true (or /agenthaven:next).' : 'The board is empty: ask your user for a goal, or use /agenthaven:plan.');
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
}

function stop(store, input = {}, { agent = 'claude-code' } = {}) {
  if (input.stop_hook_active) return null; // asked once already in this turn
  const me = selves(store, { agent, cwd: input.cwd });
  const t0 = Date.now();
  const quiet = store.listTasks({ status: 'doing', full: true })
    .filter((t) => me.has(t.assignee) && t.leaseUntil && Date.parse(t.leaseUntil) - t0 < NUDGE_WHEN_LEASE_BELOW_MS);
  if (!quiet.length) return null;
  const t = quiet[0];
  return {
    decision: 'block',
    reason: `AgentHaven: you hold task ${t.id} "${t.title}" and have not reported on it for a while; its claim expires soon. `
      + 'Before you stop, call report_progress, or submit_for_review if it is finished, or handoff_task with what is done and what is next.',
  };
}

const HOOKS = { 'session-start': sessionStart, 'pre-tool-use': preToolUse, stop };

// Entry point for `agenthaven hook <event>`. Never throws and never blocks on an
// AgentHaven error: the editor must keep working without us.
async function run(event, { store, agent, input = process.stdin, output = process.stdout } = {}) {
  const fn = HOOKS[event];
  if (!fn) return 0;
  try {
    let raw = '';
    for await (const chunk of input) raw += chunk;
    const res = fn(store(), raw.trim() ? JSON.parse(raw) : {}, { agent, projectDir: process.env.CLAUDE_PROJECT_DIR });
    if (res) output.write(`${JSON.stringify(res)}\n`);
  } catch { /* fail open */ }
  return 0;
}

module.exports = { preToolUse, sessionStart, stop, run, boardPath, selves, HOOKS };
