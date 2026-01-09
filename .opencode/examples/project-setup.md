# OpenCode Project Configuration Example

This is an example of how to configure claude-mem for an OpenCode project.

## Project Structure

```
my-project/
├── .opencode/
│   ├── opencode.jsonc       # Main OpenCode configuration
│   ├── plugin/
│   │   └── claude-mem.ts    # Claude-mem plugin (copied or symlinked)
│   └── instructions/
│       └── claude-mem.md    # Instructions for the AI
├── src/
└── ...
```

## Configuration File (.opencode/opencode.jsonc)

```json
{
  "$schema": "https://opencode.ai/config.json",
  
  // Add claude-mem instructions to system prompts
  "instructions": [
    ".opencode/instructions/claude-mem.md"
  ],
  
  // Load the claude-mem plugin
  "plugin": [
    // Option 1: Reference plugin file directly from claude-mem installation
    "file:///path/to/claude-mem/.opencode/plugin/claude-mem.ts"
    
    // Option 2: Copy plugin to your project's .opencode/plugin/
    // (OpenCode auto-loads from .opencode/plugin/*.ts)
  ],
  
  // MCP integration for memory search tools
  "mcp": {
    "claude-mem-search": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-mem/plugin/scripts/mcp-server.cjs"],
      "description": "Search past coding sessions and observations"
    }
  },
  
  // Optional: Configure providers
  "provider": {
    "opencode": {
      "options": {}
    }
  }
}
```

## Environment Variables

Create a `.env` file in your project root:

```bash
# Claude-mem worker service
CLAUDE_MEM_WORKER_PORT=37777
CLAUDE_MEM_WORKER_HOST=localhost

# Anthropic API key for memory compression
ANTHROPIC_API_KEY=sk-ant-...
```

## Global Configuration

You can also install claude-mem globally for all OpenCode projects:

### ~/.opencode/opencode.jsonc

```json
{
  "$schema": "https://opencode.ai/config.json",
  
  "plugin": [
    "file:///path/to/claude-mem/.opencode/plugin/claude-mem.ts"
  ],
  
  "mcp": {
    "claude-mem-search": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-mem/plugin/scripts/mcp-server.cjs"]
    }
  }
}
```

## Usage

Once configured, claude-mem works automatically:

1. **Start OpenCode** in your project directory
2. **Worker service** runs on localhost:37777 (auto-started by plugin)
3. **Memory context** is automatically injected into AI prompts
4. **Tool executions** are automatically captured and saved
5. **Search tools** are available via MCP (search, timeline, get_observations)

### Using Memory Search

In an OpenCode session, you can search your coding history:

```
You: "Show me how we implemented authentication last week"

AI: [Uses search tool to find relevant observations]
    [Returns context from past sessions about authentication]
```

### Viewing Memory

Open the web viewer at http://localhost:37777 to:
- Browse all observations
- Search memory visually
- View session timelines
- Check worker status

## Troubleshooting

### Worker Service Not Running

```bash
# Check if worker is running
curl http://localhost:37777/health

# Start manually if needed
cd /path/to/claude-mem
npm run worker:start
```

### Plugin Not Loading

```bash
# Check OpenCode can find the plugin
ls -la .opencode/plugin/claude-mem.ts

# Check TypeScript syntax
npx tsc --noEmit .opencode/plugin/claude-mem.ts
```

### MCP Server Not Working

```bash
# Test MCP server directly
node /path/to/claude-mem/plugin/scripts/mcp-server.cjs

# Check MCP configuration
cat .opencode/opencode.jsonc | grep -A 10 mcp
```

## Advanced: Custom Integration

You can extend the plugin for project-specific needs:

```typescript
// .opencode/plugin/my-claude-mem.ts
import { ClaudeMemPlugin } from "/path/to/claude-mem/.opencode/plugin/claude-mem.ts";
import type { Plugin } from "@opencode-ai/plugin";

export default (async (ctx) => {
  const memPlugin = await ClaudeMemPlugin(ctx);
  
  return {
    ...memPlugin,
    
    // Override or add custom hooks
    "tool.execute.after": async (input, output) => {
      // Call original hook
      await memPlugin["tool.execute.after"]?.(input, output);
      
      // Add custom behavior
      console.log("Custom tool tracking:", input.tool);
    },
  };
}) as Plugin;
```
