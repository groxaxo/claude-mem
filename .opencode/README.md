# Claude-Mem for OpenCode

This directory contains the OpenCode integration for claude-mem's persistent memory system.

## Quick Start

1. **Install claude-mem** (if not already installed):
   ```bash
   cd ~/.opencode
   git clone https://github.com/thedotmack/claude-mem.git
   cd claude-mem
   npm install
   npm run build
   ```

2. **Start the worker service**:
   ```bash
   npm run worker:start
   ```

3. **Copy OpenCode configuration to your project** (optional):
   ```bash
   # Copy to your project's .opencode directory
   cp /path/to/claude-mem/.opencode/opencode.jsonc /path/to/your/project/.opencode/
   cp /path/to/claude-mem/.opencode/plugin/claude-mem.ts /path/to/your/project/.opencode/plugin/
   cp -r /path/to/claude-mem/.opencode/instructions /path/to/your/project/.opencode/
   ```

4. **Or reference the plugin directly**:
   
   In your project's `.opencode/opencode.jsonc`:
   ```json
   {
     "plugin": ["file:///path/to/claude-mem/.opencode/plugin/claude-mem.ts"],
     "mcp": {
       "claude-mem-search": {
         "type": "stdio",
         "command": "node",
         "args": ["/path/to/claude-mem/plugin/scripts/mcp-server.cjs"]
       }
     }
   }
   ```

## What This Provides

### Automatic Memory Capture

The plugin automatically:
- Captures tool usage and outputs during your OpenCode sessions
- Sends observations to the claude-mem worker service
- Compresses observations into semantic summaries

### Context Injection

On each new session:
- Retrieves relevant context from past sessions
- Injects memory context into the system prompt
- Provides continuity across coding sessions

### Memory Search Tools (MCP)

Via the MCP integration, OpenCode gains access to:
- `search` - Search your coding history with queries and filters
- `timeline` - Get chronological context around observations
- `get_observations` - Fetch full details for specific observations

## Architecture

```
OpenCode Session
      │
      ├──> Plugin Hooks (.opencode/plugin/claude-mem.ts)
      │    ├── system.transform: Inject memory context
      │    └── tool.execute.after: Capture observations
      │
      ├──> MCP Tools (via .mcp server)
      │    └── Memory search: search, timeline, get_observations
      │
      └──> Worker Service (localhost:37777)
           ├── HTTP API for context retrieval
           ├── SQLite database for storage
           └── AI compression for summaries
```

## Configuration

### Environment Variables

- `CLAUDE_MEM_WORKER_PORT` - Worker service port (default: 37777)
- `CLAUDE_MEM_WORKER_HOST` - Worker service host (default: localhost)

### Settings File

Customize behavior in `~/.claude-mem/settings.json`:

```json
{
  "ai": {
    "model": "claude-3-5-sonnet-20241022",
    "provider": "anthropic"
  },
  "worker": {
    "port": 37777,
    "host": "localhost"
  },
  "context": {
    "maxObservations": 10,
    "maxSummaries": 5
  }
}
```

## Files in This Directory

- **`opencode.jsonc`** - OpenCode configuration (MCP, instructions)
- **`plugin/claude-mem.ts`** - OpenCode plugin adapter
- **`instructions/claude-mem.md`** - Instructions added to system prompts

## Troubleshooting

### Worker Service Not Running

Check if the worker is running:
```bash
curl http://localhost:37777/health
```

Start it manually:
```bash
cd /path/to/claude-mem
npm run worker:start
```

View logs:
```bash
tail -f ~/.claude-mem/logs/worker-$(date +%Y-%m-%d).log
```

### Plugin Not Loading

1. Check OpenCode loads the plugin:
   ```bash
   # OpenCode should show plugin loading in its output
   ```

2. Verify the plugin file exists and is readable:
   ```bash
   ls -la .opencode/plugin/claude-mem.ts
   ```

3. Check for TypeScript errors:
   ```bash
   cd .opencode
   npx tsc --noEmit plugin/claude-mem.ts
   ```

### MCP Tools Not Available

1. Verify MCP configuration in `opencode.jsonc`
2. Test MCP server directly:
   ```bash
   node /path/to/claude-mem/plugin/scripts/mcp-server.cjs
   ```

## Web Viewer

Access the memory viewer at http://localhost:37777 to:
- Browse observations and summaries
- Search memory visually
- Monitor worker status

## More Information

- Main documentation: [docs/](../../docs/)
- Claude Code plugin: [plugin/](../../plugin/)
- Architecture: [docs/architecture/](../../docs/public/architecture/)
- Troubleshooting: [docs/troubleshooting.md](../../docs/public/troubleshooting.md)

## Differences from Claude Code Integration

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| **Installation** | Plugin marketplace | Manual setup or project config |
| **Hooks** | Lifecycle hooks | Plugin API hooks |
| **Context Injection** | SessionStart hook | system.transform hook |
| **Observation Capture** | PostToolUse hook | tool.execute.after hook |
| **MCP Integration** | `.mcp.json` | `opencode.jsonc` mcp field |
| **Auto-start** | Via pre-hook | Manual or plugin-managed |

## License

This integration follows claude-mem's license: AGPL-3.0

See [LICENSE](../../LICENSE) for details.
