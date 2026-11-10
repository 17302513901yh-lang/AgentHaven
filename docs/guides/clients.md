# Connect an MCP Client

Use Node.js 20 or later with `npx` on your PATH. Each example starts AgentHaven
over stdio. Merge the entry into your existing configuration and restart the
client. Choose a distinct `--agent` name for each client sharing your board.

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

In the Codex CLI, use `/mcp` to check that AgentHaven is connected. Use plain
language to request a workflow, such as asking Codex to show the AgentHaven
board status. See the [Codex MCP documentation](https://developers.openai.com/codex/mcp).

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

Check the connection with `/mcp`. Gemini CLI exposes discovered MCP prompts by
name, so you can use `/next`, `/handoff`, `/review`, `/status`, `/plan`, or
`/dream`. See the [Gemini CLI MCP guide](https://geminicli.com/docs/tools/mcp-server/#mcp-prompts-as-slash-commands).

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

Check that AgentHaven is enabled in Cursor's MCP settings. Cursor supports MCP
prompts, and you can also ask the agent for a workflow in plain language, such
as asking it to use AgentHaven to find the next task. See the
[Cursor MCP documentation](https://cursor.com/docs/mcp).
