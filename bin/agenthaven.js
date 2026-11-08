#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { Store, defaultDataDir } = require('../src/store');

const [cmd = 'help', ...args] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--watch'].includes(args[i - 1])));
const workspace = flag('workspace', process.env.AGENTHAVEN_WORKSPACE || 'default');
const fail = (msg) => { console.error(msg); process.exit(1); };

const HELP = `AgentHaven — one shared work board for all your AI agents, from any vendor

Usage:
  agenthaven --version                                      print the installed version (also -v or version)
  agenthaven serve        [--port 4777] [--workspace name]   open the local dashboard (also runs linked workboard syncs)
  agenthaven mcp          [--agent name] [--workspace name]  run the MCP agent plugin (stdio) for any MCP client
  agenthaven config       [--agent name] [--workspace name]  print an MCP client config snippet
  agenthaven link <folder> [--workspace name]                share the board as WORKBOARD.md + LOGBOOK.md in a folder,
                                                             so agents without MCP can join by editing a file
  agenthaven unlink       [--workspace name]                 stop sharing the board as files
  agenthaven sync         [--watch] [--workspace name]       apply WORKBOARD.md Inbox commands and rewrite the board
  agenthaven instructions [--workspace name]                 text to paste into AGENTS.md, CLAUDE.md, GEMINI.md, ...
  agenthaven board        [--workspace name]                 print the board as Markdown
  agenthaven repo <path> [--base main]                       human: the git repository this board works on
  agenthaven checks "<command>" ["<command>" ...]            human: the checks AgentHaven runs before approval
  agenthaven radar                                           files changed on more than one active branch
  agenthaven dream        [--workspace name]                 look back at past mistakes now and propose lessons
  agenthaven dream --prompt                                  print the instructions for a Claude (or other LLM) dreaming agent

Scripts and training jobs can use the HTTP API of "serve" with the header
X-AgentHaven-Agent: <name> (see examples/report_progress.py).

Data is stored in ${defaultDataDir()} (override with AGENTHAVEN_HOME).`;

const store = () => new Store({ workspace });
const linkedDir = (s) => s.getSettings().workboardDir || fail(`workspace "${workspace}" is not linked to a folder; run: agenthaven link <folder>`);

switch (cmd) {
  case 'mcp':
    require('../src/mcp').serve({ store: store(), agent: flag('agent', process.env.AGENTHAVEN_AGENT) });
    break;
  case 'serve':
    require('../src/server').start({ port: Number(flag('port', 4777)), store: store(), onError: (err, ws) => console.error(`[workboard ${ws}] ${err.message}`) })
      .then(({ url }) => console.log(`AgentHaven dashboard: ${url}  (data: ${defaultDataDir()})\nEnjoying AgentHaven? A star on GitHub helps other people find it: https://github.com/laaielichter/AgentHaven`))
      .catch((err) => fail(err.message));
    break;
  case 'config': {
    const agent = flag('agent', 'claude');
    console.log(JSON.stringify({ mcpServers: { agenthaven: {
      command: process.execPath,
      args: [path.resolve(__filename), 'mcp', '--agent', agent, '--workspace', workspace],
    } } }, null, 2));
    break;
  }
  case 'link': {
    const dir = positional[0] || fail('usage: agenthaven link <folder>');
    const wb = require('../src/workboard');
    const s = store();
    const abs = path.resolve(dir);
    s.setSettings({ workboardDir: abs, workboardResults: [] });
    const r = wb.syncOnce(s, abs);
    console.log(`Linked workspace "${workspace}" to ${r.file}\nKeep "agenthaven serve" or the desktop app running to sync automatically, or run "agenthaven sync --watch".\n\nAdd this to AGENTS.md / CLAUDE.md / GEMINI.md so every agent knows:\n\n${wb.agentInstructions(abs)}`);
    break;
  }
  case 'unlink':
    store().setSettings({ workboardDir: null });
    console.log(`Workspace "${workspace}" is no longer shared as files.`);
    break;
  case 'sync': {
    const wb = require('../src/workboard');
    const s = store();
    const dir = linkedDir(s);
    if (!has('watch')) {
      const r = wb.syncOnce(s, dir);
      console.log(`${r.applied} command(s) applied, ${r.logged} logbook line(s) → ${r.file}`);
      for (const x of r.results) console.log(`${x.ok ? '✓' : '✗'} ${x.line} — ${x.message}`);
      break;
    }
    console.log(`Watching ${path.join(dir, wb.BOARD)} (Ctrl+C to stop)`);
    const w = wb.watch(s, dir, { onSync: (r) => r.results.forEach((x) => console.log(`${x.ok ? '✓' : '✗'} ${x.line} — ${x.message}`)), onError: (err) => console.error(err.message) });
    process.on('SIGINT', () => { w.stop(); process.exit(0); });
    setInterval(() => {}, 1 << 30);
    break;
  }
  case 'instructions':
    console.log(require('../src/workboard').agentInstructions(linkedDir(store())));
    break;
  case 'board':
    console.log(require('../src/workboard').renderBoard(store()));
    break;
  case 'repo': {
    const r = require('../src/git').setRepo(store(), { actor: 'you', dir: path.resolve(positional[0] || fail('usage: agenthaven repo <path>')), base: flag('base') });
    console.log(`Repository: ${r.path} (base ${r.base})`);
    break;
  }
  case 'checks': {
    const list = positional.map((command, i) => ({ name: positional.length > 1 ? `check ${i + 1}` : 'checks', command }));
    const r = require('../src/checks').setChecks(store(), { actor: 'you', checks: list });
    console.log(r.checks.length ? r.checks.map((c) => `- ${c.name}: ${c.command}`).join('\n') : 'No checks.');
    break;
  }
  case 'radar': console.log(JSON.stringify(require('../src/git').radar(store()), null, 2)); break;
  case 'run-checks': // started by AgentHaven itself in the background
    require('../src/checks').runReceipt(store(), positional[0], positional[1]).catch((err) => fail(err.message));
    break;
  case 'dream': {
    const dreams = require('../src/dream');
    if (has('prompt')) { console.log(dreams.CLAUDE_DREAMER); break; }
    const d = dreams.dream(store());
    console.log(d.summary);
    for (const p of d.proposals) console.log(`- [${p.status}] ${p.kind}: ${p.title}`);
    if (d.proposals.some((p) => p.status === 'proposed')) console.log('\nReview them in the dashboard (Dreams), or turn on auto-apply there.');
    break;
  }
  case '--version': case '-v': case 'version':
    console.log(require('../package.json').version);
    break;
  case 'help': case '--help': case '-h':
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command "${cmd}".\n`);
    console.error(HELP);
    process.exit(1);
}
