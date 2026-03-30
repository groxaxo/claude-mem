# OpenCode Project Configuration Example

Annotated example of how to enable claude-mem for an OpenCode project.

## Project Structure

```
my-project/
├── .opencode/
│   ├── opencode.jsonc        # OpenCode configuration
│   ├── plugin/
│   │   └── claude-mem.ts     # Claude-mem plugin (copied or symlinked)
│   └── instructions/
│       └── claude-mem.md     # Memory system instructions
├── src/
└── ...
```

## Configuration File (.opencode/opencode.jsonc)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // Memory system instructions injected into every system prompt
  "instructions": [
    ".opencode/instructions/claude-mem.md"
  ],

  // Load the claude-mem plugin
  // Option A: reference plugin in the claude-mem installation directory
  "plugin": [
    "file:///path/to/claude-mem/.opencode/plugin/claude-mem.ts"
  ],
  // Option B: copy the plugin to .opencode/plugin/ — OpenCode auto-loads *.ts files there

  // MCP integration for in-session memory search tools
  "mcp": {
    "claude-mem": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-mem/plugin/scripts/mcp-server.cjs"]
    }
  }
}
```

## Environment Variables

Set these in your shell profile or project `.env`:

```bash
# Override worker service port (default: 37777)
CLAUDE_MEM_WORKER_PORT=37777

# Override worker service host (default: 127.0.0.1)
CLAUDE_MEM_WORKER_HOST=127.0.0.1

# Tell the plugin where claude-mem is installed (auto-detected if not set)
CLAUDE_MEM_INSTALL_DIR=/path/to/claude-mem

# Anthropic API key for memory compression
ANTHROPIC_API_KEY=sk-ant-...
```

## Global Configuration

To enable claude-mem for **all** OpenCode projects, add to `~/.opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  "plugin": [
    "file:///path/to/claude-mem/.opencode/plugin/claude-mem.ts"
  ],

  "mcp": {
    "claude-mem": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-mem/plugin/scripts/mcp-server.cjs"]
    }
  },

  "instructions": [
    "file:///path/to/claude-mem/.opencode/instructions/claude-mem.md"
  ]
}
```

## Usage

Once configured, claude-mem works automatically:

1. **Start the worker** (once): `cd /path/to/claude-mem && npm run worker:start`
2. **Start OpenCode** in your project directory: `opencode`
3. **Memory context** is injected into system prompts via `experimental.chat.system.transform`
4. **Tool executions** are captured via `tool.execute.after`
5. **Session summaries** are triggered via `experimental.session.compacting`
6. **Search tools** are available via MCP: `search`, `timeline`, `get_observations`

### Using Memory Search

```
You: "Show me how we implemented authentication last week"

AI: [Calls `search` tool with query "authentication"]
    [Returns observations from past sessions]
    [Summarises the relevant implementation details]
```

### Viewing Memory

Open the web viewer at **http://localhost:37777** to:
- Browse all observations and summaries
- Search memory visually
- View session timelines
- Check worker health

## Troubleshooting

### Worker Service Not Running

```bash
# Check readiness
curl http://127.0.0.1:37777/api/readiness

# Start it
cd /path/to/claude-mem && npm run worker:start

# View logs
tail -f ~/.claude-mem/logs/worker-$(date +%Y-%m-%d).log
```

### Plugin Not Loading

```bash
# Check the plugin file exists
ls -la .opencode/plugin/claude-mem.ts

# Type-check it (OpenCode uses Bun's TypeScript loader)
bunx tsc --noEmit --strict .opencode/plugin/claude-mem.ts
```

### MCP Server Not Working

```bash
# Test the MCP server directly (should wait for JSON-RPC input)
node /path/to/claude-mem/plugin/scripts/mcp-server.cjs

# Confirm the worker is running
curl http://127.0.0.1:37777/api/readiness
```

## Advanced: Extending the Plugin

```typescript
// .opencode/plugin/my-claude-mem.ts
import { ClaudeMemPlugin } from "file:///path/to/claude-mem/.opencode/plugin/claude-mem.ts";
import type { Plugin } from "@opencode-ai/plugin";

export default (async (ctx) => {
  const memHooks = await ClaudeMemPlugin(ctx);

  return {
    ...memHooks,

    // Override a hook to add project-specific behaviour
    "tool.execute.after": async (input, output) => {
      // Run the original hook first
      await (memHooks["tool.execute.after"] as any)?.(input, output);

      // Then add your own logic
      if (input.tool === "bash") {
        console.log("[my-plugin] Bash command captured");
      }
    },
  };
}) as Plugin;
```

