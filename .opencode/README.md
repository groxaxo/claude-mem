# Claude-Mem for OpenCode

This directory contains the [OpenCode](https://opencode.ai) integration for claude-mem's
persistent memory system.

## Quick Start

1. **Install claude-mem** (if not already installed):
   ```bash
   git clone https://github.com/thedotmack/claude-mem.git ~/.claude-mem-src
   cd ~/.claude-mem-src
   npm install
   npm run build
   ```

2. **Start the worker service**:
   ```bash
   cd ~/.claude-mem-src
   npm run worker:start
   ```

3. **Enable for a project** — add to your project's `.opencode/opencode.jsonc`:
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

4. **Or copy the integration files into your project**:
   ```bash
   mkdir -p /path/to/your/project/.opencode/plugin
   cp /path/to/claude-mem/.opencode/plugin/claude-mem.ts \
      /path/to/your/project/.opencode/plugin/
   cp -r /path/to/claude-mem/.opencode/instructions \
      /path/to/your/project/.opencode/
   ```

## What This Provides

### Automatic Memory Capture

The plugin automatically:
- **Captures** every tool execution (read, write, bash, search, …) during OpenCode sessions
- **Compresses** observations into semantic summaries using AI
- **Stores** everything locally in `~/.claude-mem/` (SQLite + optional Chroma vectors)

### Context Injection

On every LLM request (`experimental.chat.system.transform` hook):
- Retrieves the most relevant context for the current project
- Injects it into the system prompt so the AI has memory of past work
- Requires no manual action from the user

### Session Lifecycle

| OpenCode hook | Claude Code equivalent | What it does |
|---|---|---|
| `experimental.chat.system.transform` | `SessionStart` / context-hook | Inject memory context |
| `chat.message` | `UserPromptSubmit` / new-hook | Init session in DB, start agent |
| `tool.execute.after` | `PostToolUse` / save-hook | Save observation |
| `experimental.session.compacting` | `Stop` / summary-hook | Trigger AI summary |

### Memory Search Tools (MCP)

Via the `mcp` integration, OpenCode gains:
- `search` — full-text + semantic search over past observations
- `timeline` — chronological context around a specific observation
- `get_observations` — retrieve full details by observation ID

## Architecture

```
OpenCode Session
      │
      ├── Plugin (.opencode/plugin/claude-mem.ts)
      │   ├── experimental.chat.system.transform → GET  /api/context/inject
      │   ├── chat.message                       → POST /api/sessions/init
      │   │                                        POST /sessions/:id/init
      │   ├── tool.execute.after                 → POST /api/sessions/observations
      │   └── experimental.session.compacting    → POST /api/sessions/summarize
      │
      ├── MCP Server (plugin/scripts/mcp-server.cjs)
      │   └── search / timeline / get_observations tools
      │
      └── Worker Service (http://127.0.0.1:37777)
          ├── Express HTTP API
          ├── SQLite database (~/.claude-mem/claude-mem.db)
          ├── Background SDK agent (AI compression)
          └── Optional Chroma vector index
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_MEM_WORKER_PORT` | `37777` | Worker service port |
| `CLAUDE_MEM_WORKER_HOST` | `127.0.0.1` | Worker service host |
| `CLAUDE_MEM_INSTALL_DIR` | _(auto-detected)_ | Path to claude-mem installation |

### Settings File (`~/.claude-mem/settings.json`)

```json
{
  "CLAUDE_MEM_WORKER_PORT": "37777",
  "CLAUDE_MEM_WORKER_HOST": "127.0.0.1",
  "CLAUDE_MEM_AI_MODEL": "claude-3-5-haiku-20241022",
  "CLAUDE_MEM_SKIP_TOOLS": "TodoRead,TodoWrite"
}
```

## Files in This Directory

| File | Purpose |
|---|---|
| `plugin/claude-mem.ts` | OpenCode plugin — hook implementations |
| `opencode.jsonc` | OpenCode configuration (MCP + instructions) |
| `instructions/claude-mem.md` | Memory system instructions injected into system prompt |
| `examples/project-setup.md` | Annotated example of a full project setup |

## Troubleshooting

### Worker Service Not Running

```bash
# Check if running
curl http://127.0.0.1:37777/api/readiness

# Start it
cd /path/to/claude-mem && npm run worker:start

# View today's logs
tail -f ~/.claude-mem/logs/worker-$(date +%Y-%m-%d).log
```

Set `CLAUDE_MEM_INSTALL_DIR` if the auto-detection cannot locate the worker script:

```bash
export CLAUDE_MEM_INSTALL_DIR=/path/to/claude-mem
```

### Plugin Not Loading

1. Verify the plugin file exists and is readable:
   ```bash
   ls -la .opencode/plugin/claude-mem.ts
   ```

2. Check for TypeScript errors (OpenCode uses Bun to load `.ts` files directly):
   ```bash
   bunx tsc --noEmit --strict .opencode/plugin/claude-mem.ts
   ```

3. Ensure `@opencode-ai/plugin` types are available (they ship with OpenCode):
   ```bash
   ls "$(npm root -g)/opencode-ai/node_modules/@opencode-ai/plugin"
   ```

### MCP Tools Not Available

1. Verify `mcp` entry in `opencode.jsonc`
2. Test the MCP server directly:
   ```bash
   node /path/to/claude-mem/plugin/scripts/mcp-server.cjs
   ```
3. Check worker is running (`curl http://127.0.0.1:37777/api/readiness`)

## Web Viewer

Browse captured memory at **http://localhost:37777**:
- Observation feed with search
- Session timelines
- Summary cards
- Worker health status

## More Information

- Main README: [../../README.md](../../README.md)
- Claude Code plugin: [../../plugin/](../../plugin/)
- Architecture docs: [../../docs/public/](../../docs/public/)

## License

AGPL-3.0 — see [../../LICENSE](../../LICENSE).

