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
    gemini: { label: 'Gemini CLI', file: path.join(home, '.gemini', 'settings.json') },
    codex: { label: 'Codex', file: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'), format: 'toml' },
  };
}

function serverEntry({ command, script, agent, workspace = 'default', extraEnv = {} }) {
  return { command, args: [script, 'mcp', '--agent', agent, '--workspace', workspace], ...(Object.keys(extraEnv).length ? { env: extraEnv } : {}) };
}

// Codex keeps MCP servers in TOML: replace or append our own table, leave the rest as is.
function tomlBlock(entry) {
  const q = (v) => JSON.stringify(String(v));
  const lines = ['[mcp_servers.agenthaven]', `command = ${q(entry.command)}`, `args = [${entry.args.map(q).join(', ')}]`];
  if (entry.env) lines.push(`env = { ${Object.entries(entry.env).map(([k, v]) => `${k} = ${q(v)}`).join(', ')} }`);
  return `${lines.join('\n')}\n`;
}

function readIfExists(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

function installToml(client, entry) {
  let text = readIfExists(client.file) || '';
  // The backup is the exact text we read, so it always matches what we change.
  if (text) fs.writeFileSync(`${client.file}.agenthaven-backup`, text);
  const block = tomlBlock(entry);
  const re = /^\[mcp_servers\.agenthaven\][^\n]*\n(?:(?!\[)[^\n]*\n?)*/m;
  text = re.test(text) ? text.replace(re, `${block}\n`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`;
  fs.mkdirSync(path.dirname(client.file), { recursive: true });
  fs.writeFileSync(client.file, text);
  return client;
}

function install(clientId, entry, opts = {}) {
  const client = clients(opts)[clientId];
  if (!client) throw new Error(`unknown client ${clientId}`);
  if (client.format === 'toml') return installToml(client, entry);
  let config = {};
  const raw = readIfExists(client.file);
  if (raw !== null) {
    try { config = raw.trim() ? JSON.parse(raw) : {}; } catch {
      throw new Error(`${client.file} is not valid JSON; fix it first, AgentHaven will not overwrite it`);
    }
    fs.writeFileSync(`${client.file}.agenthaven-backup`, raw);
  }
  config.mcpServers = { ...(config.mcpServers || {}), agenthaven: entry };
  fs.mkdirSync(path.dirname(client.file), { recursive: true });
  fs.writeFileSync(client.file, `${JSON.stringify(config, null, 2)}\n`);
  return client;
}

module.exports = { clients, serverEntry, install };
