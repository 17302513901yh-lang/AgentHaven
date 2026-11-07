#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { Store, defaultDataDir } = require('../src/store');

const [cmd = 'help', ...args] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const workspace = flag('workspace', process.env.AGENTHAVEN_WORKSPACE || 'default');

switch (cmd) {
  case 'mcp':
    require('../src/mcp').serve({ store: new Store({ workspace }), agent: flag('agent', process.env.AGENTHAVEN_AGENT) });
    break;
  case 'serve':
    require('../src/server').start({ port: Number(flag('port', 4777)), store: new Store({ workspace }) })
      .then(({ url }) => console.log(`AgentHaven dashboard: ${url}  (data: ${defaultDataDir()})`))
      .catch((err) => { console.error(err.message); process.exit(1); });
    break;
  case 'config': {
    const agent = flag('agent', 'claude');
    console.log(JSON.stringify({ mcpServers: { agenthaven: {
      command: process.execPath,
      args: [path.resolve(__filename), 'mcp', '--agent', agent, '--workspace', workspace],
    } } }, null, 2));
    break;
  }
  default:
    console.log(`AgentHaven — one shared workspace for all your AI agents

Usage:
  agenthaven serve  [--port 4777] [--workspace name]   open the local dashboard
  agenthaven mcp    [--agent name] [--workspace name]  run the MCP agent plugin (stdio)
  agenthaven config [--agent name]                     print an MCP client config snippet

Data is stored in ${defaultDataDir()} (override with AGENTHAVEN_HOME).`);
}
