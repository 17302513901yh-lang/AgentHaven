# Security

AgentHaven sits between AI agents and your projects, so safety bugs matter.

## Report a problem

Please use GitHub's private reporting: **Security → Report a vulnerability** on this repository.
Do not open a public issue for something another agent or website could abuse.

You will get a reply within a week.

## What counts

- The local HTTP API or dashboard reachable from another machine, or from a web page through the browser (the Host and Origin checks failing).
- An agent changing, finishing or approving a task it is not allowed to, or approving its own work.
- A file claim, lease or review gate that can be bypassed.
- Secrets or personal data from one workspace showing up in another, in `WORKBOARD.md` or in `LOGBOOK.md`.
- One-click connect damaging or leaking an MCP client's configuration.

## Supported versions

Only the latest release gets fixes.
