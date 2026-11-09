#!/bin/sh
# Starts the AgentHaven CLI for the Claude Code plugin: with Node.js when it is installed,
# otherwise with the Node.js runtime built into the AgentHaven desktop app, which writes
# its location to ~/.agenthaven/runtime each time it starts.
here=$(cd "$(dirname "$0")/.." && pwd)
script="$here/bin/agenthaven.js"
if command -v node >/dev/null 2>&1; then exec node "$script" "$@"; fi
runtime="${AGENTHAVEN_RUNTIME_FILE:-$HOME/.agenthaven/runtime}"
if [ -f "$runtime" ]; then
  exe=$(sed -n 1p "$runtime" | tr -d '\r')
  if [ -n "$exe" ] && [ -f "$exe" ]; then
    ELECTRON_RUN_AS_NODE=1 exec "$exe" "$script" "$@"
  fi
fi
# Hooks fail open: without a runtime Claude Code simply carries on.
if [ "$1" = hook ]; then exit 0; fi
echo "AgentHaven needs Node.js 20 or later, or the AgentHaven desktop app (https://github.com/laaielichter/AgentHaven/releases)." >&2
exit 1
