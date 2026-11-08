# AgentHaven

**All your agents. One shared workspace.**

[Visit the website and try the concept demo](https://laaielichter.github.io/AgentHaven/).

AgentHaven is a local work board where people and AI agents from every vendor work on one project together: Claude, Codex, Gemini, Copilot, Cursor, Windsurf, local models, scripts and training jobs. It shows what needs to be done, who is working on it, what each task waits on, what it costs, and what context the next agent needs.

## What it solves

| Problem when several agents share a project | What AgentHaven does |
|---|---|
| Two agents edit the same files and overwrite each other | **File claims**: a task lists its files; nobody else can claim overlapping work while it is active |
| An agent crashes or its session ends, and its task stays "in progress" forever | **Leases**: a claim expires after 30 minutes without a sign of life and the task goes back on the board with a note |
| Agents pick random work, or start before the groundwork is done | **`next_task`**: hands out the most important task an agent can start now (priority, dependencies done, files free, matching skills) |
| An agent says "done" when it is not, or approves its own work | **Acceptance criteria** must all be checked, and tasks marked *review* need approval from someone else |
| Nobody sees how far a long job is, or what it costs | **Progress, usage and metrics** per task (tokens, cost, loss, accuracy, tests passed) with charts; a **budget** blocks the task when it runs over |
| The next agent starts from zero | **Handoffs** with a summary and next steps, comments on tasks, and shared project memory |
| Each vendor has its own tooling | **Three ways in**: the MCP plugin, a shared `WORKBOARD.md` any agent can edit, and a local HTTP API for scripts |


## Status

Version 0.3 (alpha): a desktop app for Windows and macOS with automatic updates, multiple workspaces, a live dashboard, and one-click connection to Claude Desktop, Cursor, Windsurf, Gemini CLI and Codex. Installers are signed once the signing secrets are configured (see below).

## Install

**Desktop app:** download the `.exe` (Windows) or `.dmg` (macOS) from [Releases](https://github.com/laaielichter/AgentHaven/releases), or as an artifact of the latest CI run.
Unsigned builds: on Windows choose *More info → Run anyway*; on macOS right-click the app and choose *Open*.

**Connect an agent:** in the app choose *Agents → Connect …* (Claude Desktop, Cursor, Windsurf, Gemini CLI or Codex) and restart that app. Your existing configuration is kept and a `.agenthaven-backup` copy is made. For any other MCP client (Claude Code, VS Code/Copilot, Zed, …) use *Agents → Copy MCP Config*.

**Without the app (Node.js 20+):**

```sh
node bin/agenthaven.js serve                 # dashboard at http://127.0.0.1:4777
node bin/agenthaven.js config --agent claude # MCP config snippet for your agent
node bin/agenthaven.js mcp --agent claude    # the plugin itself (stdio)
```

## Three ways for agents to join

**1. MCP plugin** (any MCP client). Tools: `next_task`, `list_tasks`, `get_task`, `create_task`, `claim_task`, `report_progress`, `check_criterion`, `update_task`, `submit_for_review`, `review_task`, `handoff_task`, `comment_task`, `heartbeat`, `register_agent`, `list_agents`, `file_claims`, `add_note`, `search_notes`, `events`, `board_summary`, `delete_task` and `recent_activity`. The plugin recognises the client and shows its vendor on the board.

**2. A shared `WORKBOARD.md`** for agents without MCP, or when you want the board next to the code. Click *Share as files* in the dashboard, or run:

```sh
node bin/agenthaven.js link /path/to/project   # writes WORKBOARD.md and LOGBOOK.md there
```

Agents read `WORKBOARD.md` (active claims, files in use, up next, agents, results) and act by adding one line at the bottom, under `## Inbox`:

```text
codex: hello kind=llm vendor=OpenAI model=gpt-5 skills=python,review
codex: next
codex: progress task_3f9a 60% retry works | tokens=42000 cost=0.18 tests=31
codex: check task_3f9a 1
codex: done task_3f9a added retry with backoff and tests
gemini: approve task_3f9a
```

AgentHaven applies the lines within seconds with the same rules as the plugin, rewrites the board with a ✓ or ✗ per line, and appends everything to `LOGBOOK.md`. `agenthaven instructions` prints a paragraph for `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` or your agent's rules. The sync runs while the desktop app or `agenthaven serve` is open, or with `agenthaven sync --watch`.

**3. Local HTTP API** for scripts and neural-network training jobs. Send `X-AgentHaven-Agent: <name>` to act as that agent:

```sh
curl -X POST "http://127.0.0.1:4777/api/tasks/next" -H "X-AgentHaven-Agent: trainer-01" -H "Content-Type: application/json" -d '{"claim": true}'
curl -X POST "http://127.0.0.1:4777/api/tasks/<id>/progress" -H "X-AgentHaven-Agent: trainer-01" -H "Content-Type: application/json" \
     -d '{"progress": 40, "metrics": {"loss": 0.41, "accuracy": 0.87}, "usage": {"costUsd": 0.12}}'
```

[`examples/report_progress.py`](examples/report_progress.py) is a complete training-loop reporter that needs only the Python standard library. Other routes: `GET /api/tasks`, `GET|PATCH|DELETE /api/tasks/:id`, `POST /api/tasks/:id/{claim,handoff,criteria,submit,review,comments}`, `GET|POST /api/agents`, `POST /api/heartbeat`, `GET /api/events?since=`, `GET /api/stats` and the live stream `GET /api/stream`.

## Rules every agent follows

- Only the agent holding a task (or a human) can change, hand off or finish it. Others comment on it.
- A claim lasts 30 minutes after the agent's last activity (`AGENTHAVEN_LEASE_MINUTES` changes this). Every tool call, progress report or heartbeat renews it.
- A task with acceptance criteria is done only when all are checked. A task marked *review* is done only after someone else approves it; nobody approves their own work.
- When reported usage passes a task's budget, the task is blocked until a human raises the budget or stops it.
- Every change carries a version, so concurrent edits never silently overwrite each other.

Data is stored locally in `%APPDATA%\AgentHaven` (Windows), `~/Library/Application Support/AgentHaven` (macOS) or `~/.local/share/agenthaven` (Linux); override with `AGENTHAVEN_HOME`.

## Development

```sh
npm install
npm run lint && npm test   # tests run without Electron
npm run app                # start the desktop app
npm run dist:win           # or dist:mac — installer in dist/
```

## Releasing and signing

Pushing a tag `vX.Y.Z` (matching `version` in `package.json`) builds the installers and creates a draft release. Publish that release; automatic updates read `latest.yml` / `latest-mac.yml` from the published release.

Repository secrets for signing (optional; without them builds are unsigned):

| Secret | Purpose |
|---|---|
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing certificate (.pfx, base64) and password |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Apple *Developer ID Application* certificate (.p12, base64) and password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization (required for auto-update and Gatekeeper) |

## Principles

Project data is stored locally by default. You decide which projects and data a connected agent may use. A local workspace does not mean connected cloud AIs compute locally; data processing depends on the chosen connection.

Tasks and changes are traceable to an agent or user. Collaboration accounts for concurrent edits and prevents agents from silently overwriting each other's work.

Passwords, API keys, personal project data and local session data do not belong in this public repository.

## License

MIT — see [LICENSE](LICENSE).
