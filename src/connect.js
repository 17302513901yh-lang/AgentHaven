'use strict';
// One-click agent connection: merges the AgentHaven MCP server into the
// config file of known MCP clients, keeping all other settings intact.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clients({ home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const claudeDir = platform === 'win32' ? path.join(appData, 'Claude')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude')
      : path.join(home, '.config', 'Claude');
  return {
    claude: { label: 'Claude Desktop', file: path.join(claudeDir, 'claude_desktop_config.json') },
    cursor: { label: 'Cursor', file: path.join(home, '.cursor', 'mcp.json') },
    windsurf: { label: 'Windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json') },
  };
}

function serverEntry({ command, script, agent, workspace = 'default', extraEnv = {} }) {
  return { command, args: [script, 'mcp', '--agent', agent, '--workspace', workspace], ...(Object.keys(extraEnv).length ? { env: extraEnv } : {}) };
}

function install(clientId, entry, opts = {}) {
  const client = clients(opts)[clientId];
  if (!client) throw new Error(`unknown client ${clientId}`);
  let config = {};
  if (fs.existsSync(client.file)) {
    const raw = fs.readFileSync(client.file, 'utf8');
    try { config = raw.trim() ? JSON.parse(raw) : {}; } catch {
      throw new Error(`${client.file} is not valid JSON; fix it first, AgentHaven will not overwrite it`);
    }
    fs.copyFileSync(client.file, `${client.file}.agenthaven-backup`);
  }
  config.mcpServers = { ...(config.mcpServers || {}), agenthaven: entry };
  fs.mkdirSync(path.dirname(client.file), { recursive: true });
  fs.writeFileSync(client.file, `${JSON.stringify(config, null, 2)}\n`);
  return client;
}

module.exports = { clients, serverEntry, install };
