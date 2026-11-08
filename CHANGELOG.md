# Changelog

All notable changes to AgentHaven. Full notes for each version are in [`docs/releases/`](docs/releases/),
and the installers are on the [Releases page](https://github.com/laaielichter/AgentHaven/releases).

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
