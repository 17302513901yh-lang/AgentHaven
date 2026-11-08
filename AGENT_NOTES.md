# Agent notes

## Structure
- `src/store.js` core (no deps): one JSON file per workspace, atomic write (tmp + rename), lock via `mkdir <file>.lock` (stale after 10 s), activity log capped at 5000. File claims: active tasks (doing/blocked/review) with an assignee block overlapping paths (equal or folder prefix) for other agents.
- Board model (schema 2, old files upgrade on read): leases (`leaseUntil`, reaped inside `withLock` and by `fresh()`), `dependsOn` (cycle check), `priority` 0-3, `skills`, `criteria`, `review`, `progress`/`usage`/`metrics`/`budget`, `comments`, `agents` registry, `seq` cursor on the log. Only the assignee or a human (`you` or kind `human`) may change a claimed task.
- `src/workboard.js` WORKBOARD.md (generated view + `## Inbox` command lines) and append-only LOGBOOK.md; `syncOnce` keeps Inbox lines added during a sync. Linked folder lives in workspace `settings.workboardDir`; `server.js` resumes the watchers on start.
- Collaboration (store.js): `messages` (+ `msgSeq`, per-agent `inboxSeq`), `inbox`, task `questions` (asking holder → blocked until answered), `splitTask` (`parent`; split parents cannot be claimed or closed early), review `reviewer`/`reviewsRequired`/`approvals`/`verification` (required), `counters` + `escalate` at 3 (expiries, rejections, bounces), `getContext`, `settings.goal`, `settings.lead`. `isAuthority` = human or lead; `agentsOnly` defaults on while no human was ever seen.
- `src/dream.js` dreaming: `digest` (since `settings.dreamSeq`), rule-based `heuristicProposals`, `recordDream` (data.dreams, last 50), `applyProposal`/`dismissProposal` (human only unless `settings.dream.autoApply`; applier "agenthaven"), `lessonsFor` (notes tagged `lesson` with `scope` {files, skills, agent}), `schedule` (server runs it per workspace). MCP/HTTP/workboard attach lessons to get/next/claim.
- `src/mcp.js` MCP server over stdio, hand-written (newline JSON-RPC); no SDK. Registers the client with a vendor guessed from `clientInfo.name`.
- `src/server.js` HTTP API + `ui/` dashboard, 127.0.0.1 only, Host/Origin check. Workspace via `?workspace=`.
- `src/connect.js` merges the MCP entry into Claude Desktop/Cursor/Windsurf/Gemini CLI JSON configs (backup, refuses invalid JSON) and the Codex TOML config (replaces only `[mcp_servers.agenthaven]`).
- `src/server.js` acts as the agent named in `X-AgentHaven-Agent`, else as the human `you`. `/api/stream` is SSE (polls the workspace file mtime).
- `desktop/main.js` Electron shell + electron-updater (GitHub Releases). `bin/agenthaven.js` CLI.
- `docs/` = GitHub Pages site (plain HTML/CSS/JS, no build). `docs/assets/dashboard.png|webp` is a real screenshot of the dashboard with a seeded demo workspace; `docs/assets/social.png` (1280x640) is the social preview, also used by README and `og:image`. Retake both when the UI changes visibly. All repo-facing text (README, site, UI, commits) is English.

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
- Access depends on the current session. A regular Git push requires its own authenticated credentials; repository permissions reported by a connector do not authenticate the local Git client.
- Files in another agent session are not automatically available here. Transfer prepared work through a pushed Git branch or an attached bundle/patch archive.
- The supplied bundle exported `HEAD`, not the documented feature branch ref. After `git bundle verify`, import it with `git fetch /path/to/agenthaven-feature.bundle HEAD:refs/heads/feat/desktop-app-and-mcp-plugin`.

## Verification for the 0.2 PR
- `npm ci` completed on Linux; the committed lockfile is present and the desktop CI job already uses `npm ci` without a lockfile TODO.
- Lint and all 10 tests passed on Linux with Node 24.22.1 and Node 22.23.4.
- `build/icon.png` is a 1024x1024 PNG.
- PR CI passed lint and all 10 tests on real Windows, macOS and Ubuntu runners; both native installer builds and CodeQL passed.
- Both downloaded artifact ZIPs passed integrity checks. Windows includes the NSIS installer, blockmap and `latest.yml`; macOS includes universal DMG/ZIP, blockmaps and `latest-mac.yml`.
- Native installed-app smoke tests and Claude Desktop tool discovery remain unverified: this session provides Linux only. Local Chromium failed to start because process-singleton socket creation was denied; the shared browser could not reach the local dashboard. No screenshot or native UI result is claimed.
- No signing certificates were supplied; signing and notarization have not been verified.
- The owner authorized autonomous squash merge. The release job bootstraps `v0.2.0` once on a green main-branch run, never retargets an existing tag, and leaves the release as a draft. Later releases still use version tags.
