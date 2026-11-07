# Agent notes

## Structuur
- `src/store.js` kern (geen dependencies): JSON-bestand per werkplek, atomic write (tmp + rename), lock via `mkdir <file>.lock` (stale na 10 s), activiteitenlog max 5000.
- `src/mcp.js` MCP-server over stdio, zelf geïmplementeerd (newline-JSON-RPC); geen SDK nodig.
- `src/server.js` HTTP-API + `ui/` dashboard, alleen 127.0.0.1, Host/Origin-check (DNS-rebinding/CSRF).
- `desktop/main.js` Electron-shell (Windows/macOS), `bin/agenthaven.js` CLI (`serve`, `mcp`, `config`).
- `docs/` = GitHub Pages-website (Engels); los van de app.

## Commando's
- `npm run lint && npm test` (node:test, geen Electron nodig). `npm test` = `node --test` zonder pad: `node --test test/` faalt op Node 22.
- Packaging lokaal checken: `npx electron-builder --linux dir`; app-smoketest: `xvfb-run -a dist/linux-unpacked/agenthaven --no-sandbox`.

## Valkuilen
- Plugin in de verpakte app draait via de app-exe met `ELECTRON_RUN_AS_NODE=1`; daarom `asar: false` zodat `bin/` en `src/` gewone bestanden zijn.
- Updates vereisen `version` (optimistic concurrency); conflict = `ConflictError` → HTTP 409 / MCP `isError`.
- Actor-naam: `--agent` / `AGENTHAVEN_AGENT`, anders `clientInfo.name` uit `initialize`.
- Installers zijn unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`); signing vereist secrets.

## Conventies
- Actions gepind op commit-SHA met versiecommentaar; bij annotated tags de `^{}`-SHA nemen (`git ls-remote`).
- Commits: conventional (`feat:`, `ci:`, `docs:`). README in het Nederlands, website in het Engels.
- CI gebruikt nog `npm install` (lockfile niet gecommit: de MCP-pushtool is ongeschikt voor grote bestanden). Lockfile toevoegen en naar `npm ci` overstappen.
