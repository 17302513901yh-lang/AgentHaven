'use strict';
// Ready-made ways of working, offered as MCP prompts. Clients show them as
// slash commands: /mcp__agenthaven__next in Claude Code (or /agenthaven:next
// with the Claude Code plugin), /next in Gemini CLI, and so on.
// The Claude Code plugin's commands in claude/commands/ are generated from
// this file by scripts/claude-commands.js; a test keeps them in sync.
const { CLAUDE_DREAMER } = require('./dream');

const PROMPTS = [
  {
    name: 'next',
    title: 'Take the next task',
    description: 'Pick up the most important task you can do now and work it through to review.',
    arguments: [],
    text: () => `Work on the AgentHaven board, using the agenthaven tools.

1. Call inbox and deal with anything addressed to you first (questions you can answer, reviews assigned to you, answers to your own questions).
2. Call next_task with claim=true. If there is nothing to do, say so and stop.
3. If someone else worked on the task before, call get_context. Read the lessons that come with the task: they are mistakes earlier agents made here.
4. Do the work. Touch only the files of your task; if you need others, add them with update_task first. If something is unclear, call ask_question instead of guessing.
5. While you work, call report_progress now and then (percent, a short message, and tokens or cost if you know them). Tick acceptance criteria with check_criterion as you meet them.
6. Commit your work, then call submit_for_review with a summary and the verification: the commands or tests you ran and their results. For a task without review, call update_task with status "done".
7. If you cannot finish, call handoff_task with what you did and what is next.`,
  },
  {
    name: 'handoff',
    title: 'Hand off your task',
    description: 'Wrap up your current task so another agent (or you, later) can continue without losing anything.',
    arguments: [{ name: 'to', description: 'Who takes over: an agent name or "skill:<name>". Leave empty to put the task back on the board.', required: false }],
    text: ({ to } = {}) => `Wrap up your work on the AgentHaven board, using the agenthaven tools.

1. Call list_tasks with your name as assignee to find the task(s) you hold.
2. Commit what is worth keeping. Call report_progress with the current percent and what you were doing.
3. Call handoff_task${to ? ` with to "${to}"` : ' (leave "to" empty to return it to the board)'}. The summary says what is done and how you checked it; nextSteps says exactly what is left, which files, and anything that surprised you.
4. Save knowledge the next agent needs beyond this task with add_note.`,
  },
  {
    name: 'review',
    title: 'Review waiting work',
    description: 'Review tasks waiting for you: read the work and the check results, then approve or send back.',
    arguments: [],
    text: () => `Review work on the AgentHaven board, using the agenthaven tools. If review_task is not in your tools, call enable_tools with profiles ["review"] first.

1. Call inbox and list_tasks with status "review". Pick the tasks assigned to you, or unassigned reviews you have the skills for. You cannot review your own work.
2. For each task, call get_context. Read the acceptance criteria, the summary and the verification, and look at the real change (the task's branch or files).
3. If AgentHaven checks are configured, a passing receipt for the submitted commit is required; call run_checks when there is none.
4. Call review_task: approve only when every criterion is met and the change does what the task asks. Otherwise send it back with a comment that says exactly what must change.`,
  },
  {
    name: 'status',
    title: 'Board status',
    description: 'A short report of the board for your user: goal, progress, who works on what, and what waits on a human.',
    arguments: [],
    text: () => `Give your user a short status of the AgentHaven board, using the agenthaven tools.

1. Call inbox and list_tasks.
2. Report in a few lines: the goal and how close it is, what is being worked on and by whom, what is blocked and why, what waits on review, and every question or escalation that needs a human. End with the one thing the user should do next, if any.
Do not change anything on the board.`,
  },
  {
    name: 'plan',
    title: 'Plan a goal as tasks',
    description: 'Turn a goal into small tasks with files, acceptance criteria and dependencies, so several agents can work in parallel.',
    arguments: [{ name: 'goal', description: 'What you want done', required: true }],
    text: ({ goal } = {}) => `Turn this goal into work on the AgentHaven board, using the agenthaven tools:

${goal ? `Goal: ${goal}` : 'Goal: ask your user for the goal first.'}

1. Call list_tasks and search_notes so you do not plan work that already exists.
2. Read enough of the code to know which files each part touches.
3. Create tasks with create_task. Each task is small enough for one session, lists its files (so parallel agents do not collide), has acceptance criteria that can be checked, and names the skills it needs. Use dependsOn for what must come first, and review=true for risky changes.
4. Show your user the plan as a short list (title, files, depends on) and ask before anyone starts, unless they told you to go ahead.`,
  },
  {
    name: 'dream',
    title: 'Dream: learn from past mistakes',
    description: 'Look back at what went wrong on the board and propose lessons for the next agents.',
    arguments: [],
    text: () => CLAUDE_DREAMER,
  },
];

const describe = ({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args });

function getPrompt(name, args = {}) {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) return null;
  const missing = prompt.arguments.find((a) => a.required && !String(args[a.name] ?? '').trim());
  if (missing) throw Object.assign(new Error(`Missing argument: ${missing.name}`), { code: 'INVALID' });
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }],
  };
}

module.exports = { PROMPTS, describe, getPrompt };
