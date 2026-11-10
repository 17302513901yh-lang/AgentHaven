# Changelog

All notable changes to AgentHaven. Full notes for each version are in [`docs/releases/`](docs/releases/),
and the installers are on the [Releases page](https://github.com/laaielichter/AgentHaven/releases).

## Unreleased

- **Guard removes Discord bot tokens** before anything is stored, next to the Groq, SendGrid and Replicate keys of 0.7.0. Thanks to @jdotc1 for the follow-up! (#33)

## 0.7.0

A closer look at the board from the terminal, and Guard recognises more keys. [Full notes](docs/releases/v0.7.0.md)

- **`agenthaven status`** prints a short summary of the board: the goal, counts per status, who works on what and what waits on a human. Thanks to @IG-ABHINAV for this, their first contribution to AgentHaven! (#16, #28)
- **`agenthaven tools`** lists the MCP tool profiles, and `agenthaven tools <profile>` describes each tool in one. Thanks to @Daiyuanranfeng! (#19, #29)
- **Guard removes more provider keys** before anything is stored: Groq (`gsk_`), SendGrid (`SG.`, also keys that end in a hyphen) and Replicate (`r8_`). Thanks to @jdotc1 for the careful patterns and tests, their first contribution to AgentHaven! (#7, #31)

## 0.6.0

Seamless: agents connect by themselves, and the desktop app updates from the dashboard. [Full notes](docs/releases/v0.6.0.md)

- **Agents connect by themselves**: the desktop app finds Claude Desktop, Claude Code, Cursor, VS Code (Copilot), Windsurf, Gemini CLI, Codex and LM Studio, connects them at start and every 10 minutes, repairs connections that point to an old or moved app, and says so once in a banner. A **Connect agents** panel in the dashboard shows each app with *Connect*, *Reconnect* and *Disconnect* and a switch for the automatic mode; `agenthaven connect` does the same from a terminal. Settings files with comments are read, files are replaced atomically with a backup, and Claude Code with the plugin is left alone.
- **The Claude Code plugin works without Node.js** when the desktop app is installed: its hooks use the app's built-in runtime, and the app connects Claude Code's MCP tools itself until Node.js is installed.

- **Updates in the dashboard** (desktop app): an update bar with download progress, release notes, *Restart and update*, *Later* and *Skip this version*, a version button in the header with an auto-check switch, and a one-time "updated to" note. Windows installs silently on restart; an unsigned macOS build downloads and opens the new `.dmg` instead of failing.

- `examples/report_progress.mjs`: the training-loop reporter for Node.js 20+, with no dependencies, next to the Python one. Thanks to @Daiyuanranfeng for this, and for the careful end-to-end test! (#14)

## 0.5.0

A smarter plugin for agents. [Full notes](docs/releases/v0.5.0.md)

- **Claude Code plugin** with slash commands (`/agenthaven:next`, `handoff`, `review`, `status`, `plan`, `dream`) and three hooks: a briefing at session start, a refusal to edit files another agent has claimed, and a nudge to report or hand off before going quiet on a task.
- **Tool profiles**: sessions start with 19 core tools (43% fewer tokens of tool descriptions); `enable_tools` adds `code`, `review`, `plan`, `team`, `lead` or `dream` on demand, and profiles follow the agent's role.
- **Tool annotations** (read-only, destructive), **compact results** (about 30% fewer tokens) and `structuredContent` for MCP 2025-06-18 clients.
- **MCP prompts**: the same six ways of working as slash commands in any client that supports prompts.
- **One board name per session**: two sessions of the same agent become `name` and `name#2`, with their own claims and leases.
- `agenthaven --version` (also `-v` and `version`) prints the installed version. Thanks to @Daiyuanranfeng for this, the first outside contribution to AgentHaven! (#11)
- The README, website, desktop app (*Help*), dashboard and `agenthaven serve` now invite people to contribute and to star the project. The dashboard asks once, after your agents finish five tasks, and never again after *Not now*.

## 0.4.0

Safety and proof for teams of agents from different vendors. [Full notes](docs/releases/v0.4.0.md)

- **Guard**: secrets are removed before anything is stored, invisible characters are stripped, and instruction-like notes are quarantined until a human releases them.
- **Git scope**: a worktree and branch per task, `check_scope` against the files a task claims, and `conflict_radar` across active branches.
- **Verified checks**: AgentHaven runs the human-set checks on the submitted commit and keeps a receipt; approval needs a pass, and changed tests or CI need a human.
- Dashboard panels for Guard and Code & checks; CLI `repo`, `checks` and `radar`.

## 0.3.0

One work board for agents from every vendor. [Full notes](docs/releases/v0.3.0.md)

- Claims that expire (leases), `next_task`, dependencies, priorities and skills.
- Acceptance criteria, review by someone else, progress, usage, metrics and budgets.
- Working together: inbox, questions, messages, handoffs to a skill, reviewer routing, subtasks, `get_context`, escalation, a shared goal and agents-only mode with a lead.
- Dreaming: lessons from past mistakes that reach the next agent.
- `WORKBOARD.md` for agents without MCP, and a local HTTP API for scripts and training jobs.
- One-click connect for Gemini CLI and Codex.

## 0.2.0

The first desktop app. [Full notes](docs/releases/v0.2.0.md)

- Windows and macOS installers with automatic updates.
- Live task board, workspaces, shared notes, handoffs and file claims.
- MCP plugin and one-click connect for Claude Desktop, Cursor and Windsurf.
