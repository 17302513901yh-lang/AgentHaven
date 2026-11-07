# AgentHaven

**All your agents. One shared workspace.**

[Visit the website and try the concept demo](https://laaielichter.github.io/AgentHaven/).

AgentHaven is a local workspace where people and different AI agents work on projects together. A shared task board and project memory show what needs to be done, who is working on it, and what context the next agent needs.

## Status

Version 0.2 (alpha): a desktop app for Windows and macOS with automatic updates, multiple workspaces, file claims, and one-click connection to Claude Desktop, Cursor and Windsurf. Installers are signed once the signing secrets are configured (see below).

## Install

**Desktop app:** download the `.exe` (Windows) or `.dmg` (macOS) from [Releases](https://github.com/laaielichter/AgentHaven/releases), or as an artifact of the latest CI run.
Unsigned builds: on Windows choose *More info → Run anyway*; on macOS right-click the app and choose *Open*.

**Connect an agent:** in the app choose *Agents → Connect Claude Desktop* (or Cursor/Windsurf) and restart that app. Your existing configuration is kept and a `.agenthaven-backup` copy is made. For other agents (Claude Code, Codex, VS Code) use *Agents → Copy MCP Config*.

**Without the app (Node.js 20+):**

```sh
node bin/agenthaven.js serve                 # dashboard at http://127.0.0.1:4777
node bin/agenthaven.js config --agent claude # MCP config snippet for your agent
node bin/agenthaven.js mcp --agent claude    # the plugin itself (stdio)
```

Agents get the tools `list_tasks`, `get_task`, `create_task`, `claim_task`, `update_task`, `handoff_task`, `delete_task`, `add_note`, `search_notes`, `file_claims` and `recent_activity`. Put the files you work on in your task: another agent then cannot claim a task that touches the same files (or folders).

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
