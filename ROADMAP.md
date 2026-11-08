# Roadmap

Where AgentHaven is going next, for the plugin agents use and the dashboard people use. Plans change with
feedback: [open an issue](https://github.com/laaielichter/AgentHaven/issues/new/choose) if something here
matters to you, or if something is missing. Items marked `good first issue` or `help wanted` are open for
contributors; comment on the issue before you start.

## Phase 1: a smarter plugin (0.5, done)

- [x] **Claude Code plugin with hooks**: a briefing at session start, edits to files another agent has claimed are refused, and a nudge to report or hand off before going quiet on a task.
- [x] **Slash commands** from MCP prompts: `next`, `handoff`, `review`, `status`, `plan`, `dream`.
- [x] **Tool profiles**: 19 core tools to start with (43% fewer tokens of tool descriptions), more with `enable_tools` or by role.
- [x] **Tool annotations**: read-only and destructive tools are marked, so clients ask less.
- [x] **Compact, structured results**: about 30% fewer tokens, plus `structuredContent`.
- [x] **One board name per session**: `claude-code` and `claude-code#2` no longer share claims.
- [ ] The same hooks for Gemini CLI ([#21](https://github.com/laaielichter/AgentHaven/issues/21)) and Codex.
- [ ] More one-click connects: Zed ([#9](https://github.com/laaielichter/AgentHaven/issues/9)) and VS Code / Copilot ([#12](https://github.com/laaielichter/AgentHaven/issues/12)).

## Small things anyone can pick up

- [ ] `agenthaven status` in the terminal ([#16](https://github.com/laaielichter/AgentHaven/issues/16))
- [ ] `?` shows the dashboard's keyboard shortcuts ([#17](https://github.com/laaielichter/AgentHaven/issues/17))
- [ ] A setup guide for Codex, Gemini CLI and Cursor ([#18](https://github.com/laaielichter/AgentHaven/issues/18))
- [ ] `agenthaven tools` lists the tool profiles ([#19](https://github.com/laaielichter/AgentHaven/issues/19))
- [ ] Guard: more API key formats ([#7](https://github.com/laaielichter/AgentHaven/issues/7))

## Phase 2: people in the loop (0.6)

- [ ] **Approvals queue** in the dashboard: reviews, questions to humans, escalations, budgets and quarantined notes in one list, operated from the keyboard.
- [ ] **Review with the diff**: the task's real git diff, the check receipt and the scope result side by side, with approve or send back.
- [ ] **Notifications** ([#20](https://github.com/laaielichter/AgentHaven/issues/20)): desktop notifications and a tray badge when an agent asks a human, a review is ready or a task escalates.
- [ ] **Questions in the client** (MCP elicitation): a question for humans, or a budget raise, appears as a form in Claude, Cursor or VS Code.
- [ ] **Live updates for agents**: the board as MCP resources with update notifications, so agents react to their inbox instead of polling.

## Phase 3: from board to control room (0.7)

- [ ] **Start agents from the dashboard**: run Claude Code, Codex or Gemini CLI headless in the task's worktree, with live output and a stop button.
- [ ] **Timeline** per agent and per task: claims, progress, handoffs and checks, to replay what happened.
- [ ] **Automatic cost tracking**: a hook reports token use, with a cost view per agent, vendor and goal, and a budget for the whole goal.
- [ ] **Playbooks**: one click turns "feature: plan → build → review → test" into subtasks with the right skills and order.
- [ ] **Dependency graph** with the critical path ([#22](https://github.com/laaielichter/AgentHaven/issues/22)).

## Later, if people need it

- MCP over HTTP (Streamable HTTP) for cloud agents, with a token per agent.
- A phone view for approvals on the go, through a secure tunnel.
- Several people on one board.
- A Linux desktop build ([#10](https://github.com/laaielichter/AgentHaven/issues/10)).

## How we measure it

Tokens per tool call, write conflicts between agents (target: none), the time from "review ready" to a decision,
and the share of tasks that finish without a human stepping in.
