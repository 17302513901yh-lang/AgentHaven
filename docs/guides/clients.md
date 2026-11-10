# Connect an MCP Client

With Node.js 20 or later, run `npx -y github:laaielichter/AgentHaven connect` to
configure detected clients, or use `agenthaven connect cursor codex gemini` to
select clients explicitly if AgentHaven is already installed. Use
`agenthaven connect --list` to check their connection status. The desktop app
configures detected clients automatically by default.

For manual setup, use the stdio examples below. Merge the entry into your
existing configuration and restart the client. Choose a distinct `--agent` name
for each client sharing your board.

AgentHaven starts with the core tools. Ask the client to call `enable_tools`
when it needs more. If the client does not refresh its tool list during a
session, append `"--tools", "all"` to the launch arguments to expose every
profile at startup.

On Windows, if the client cannot launch the `npx` shim, use `"cmd"` as the
command and prepend `"/c", "npx"` to the args in the examples below.

## Codex

Add this entry to `~/.codex/config.toml`.

```toml
[mcp_servers.agenthaven]
command = "npx"
args = ["-y", "github:laaielichter/AgentHaven", "mcp", "--agent", "codex"]
startup_timeout_sec = 120
```

If you already have a local checkout, you can launch it directly. Replace the
Codex entry above with this one and use the absolute path to your checkout.

```toml
[mcp_servers.agenthaven]
command = "node"
args = ["/path/to/AgentHaven/bin/agenthaven.js", "mcp", "--agent", "codex"]
```

In the Codex CLI, use `/mcp` to check that AgentHaven's tools are available.
AgentHaven prompt discovery as slash commands was not verified in Codex. To run
a workflow, ask in plain language, such as asking Codex to show the AgentHaven
board status. See the [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Gemini CLI

Add the server under `mcpServers` in `~/.gemini/settings.json`.

```json
{
  "mcpServers": {
    "agenthaven": {
      "command": "npx",
      "args": ["-y", "github:laaielichter/AgentHaven", "mcp", "--agent", "gemini"]
    }
  }
}
```

Check the connection and discovered prompts with `/mcp`. According to the
[Gemini CLI MCP guide](https://geminicli.com/docs/tools/mcp-server/#mcp-prompts-as-slash-commands),
Gemini CLI can invoke discovered MCP prompts by name. For example, use `/next`
if it appears under AgentHaven's prompts.

## Cursor

Use `~/.cursor/mcp.json` for all projects or `.cursor/mcp.json` in a specific project.

```json
{
  "mcpServers": {
    "agenthaven": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:laaielichter/AgentHaven", "mcp", "--agent", "cursor"]
    }
  }
}
```

Check that AgentHaven is enabled in Cursor's MCP settings. The
[Cursor MCP documentation](https://cursor.com/docs/mcp) lists prompt support.
If AgentHaven's prompts do not appear in your client, ask in plain language,
such as asking the agent to use AgentHaven to find the next task.
