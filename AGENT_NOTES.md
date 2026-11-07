# Agent notes

## Structure
- `src/store.js` core (no deps): one JSON file per workspace, atomic write (tmp + rename), lock via `mkdir <file>.lock` (stale after 10 s), activity log capped at 5000. File claims: active tasks (doing/blocked/review) with an assignee block overlapping paths (equal or folder prefix) for other agents.
- `src/mcp.js` MCP server over stdio, hand-written (newline JSON-RPC); no SDK.
- `src/server.js` HTTP API + `ui/` dashboard, 127.0.0.1 only, Host/Origin check. Workspace via `?workspace=`.
- `src/connect.js` merges the MCP entry into Claude Desktop/Cursor/Windsurf configs (backup, refuses invalid JSON).
- `desktop/main.js` Electron shell + electron-updater (GitHub Releases). `bin/agenthaven.js` CLI.
- `docs/` = GitHub Pages site. All repo-facing text (README, site, UI, commits) is English.

## Commands
- `npm run lint && npm test` (node:test, no Electron). Use `node --test` without a path; `node --test test/` fails on Node 22.
- Packaging check: `npx electron-builder --linux dir`; smoke test + screenshot: `xvfb-run -a -s "-screen 0 1400x900x24" bash -c 'dist/linux-unpacked/agenthaven --no-sandbox & sleep 10; import -window root /tmp/shot.png'`.

## Pitfalls
- Plugin inside the packaged app runs through the app exe with `ELECTRON_RUN_AS_NODE=1`, hence `asar: false`.
- Updates require `version` (optimistic concurrency) → HTTP 409 / MCP `isError`.
- Signing: separate `WIN_*` / `MAC_*` secrets (one CSC_LINK can't serve both). macOS auto-update needs the `zip` target and a signed+notarized build.
- Auto-update only sees *published* releases; CI creates drafts.

## Conventions
- Pin actions to commit SHA with version comment; for annotated tags use the `^{}` SHA (`git ls-remote`).
- Conventional commits (`feat:`, `ci:`, `docs:`).

## Access
- The GitHub integration here is read-only on laaielichter/AgentHaven (403 on branch create). Deliver as bundle + patches + Codex prompt; owner pushes.
