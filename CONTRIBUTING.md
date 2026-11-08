# Contributing to AgentHaven

Thanks for helping. Small fixes and big ideas are both welcome.

## Ways to help

- Report a bug or suggest a feature with the issue forms.
- Pick an issue labeled `good first issue`.
- Try AgentHaven with an agent or MCP client we have not tested, and tell us what happened.
- Improve the docs, the website (`docs/`) or add an example to `examples/`.

## Set up

You need Node.js 20 or later.

```sh
git clone https://github.com/laaielichter/AgentHaven.git
cd AgentHaven
npm install
npm run lint && npm test   # runs without Electron
npm run serve              # dashboard at http://127.0.0.1:4777
npm run app                # the desktop app
```

[AGENT_NOTES.md](AGENT_NOTES.md) explains how the code is laid out. `src/store.js` holds the board rules;
the MCP plugin (`src/mcp.js`), the HTTP API (`src/server.js`) and `WORKBOARD.md` (`src/workboard.js`) all go
through it, so a rule changed there applies everywhere.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Keep each pull request to one change, with a [conventional commit](https://www.conventionalcommits.org/) title (`feat:`, `fix:`, `docs:`, `ci:`).
3. Add or update tests, and the README or website when behaviour changes.
4. Run `npm run lint && npm test`, and say in the pull request what you changed and how you checked it.

All repo-facing text (code, docs, UI, commits) is in English.

## Be kind

We follow the [Code of Conduct](CODE_OF_CONDUCT.md). Be patient and specific; we will do the same.
