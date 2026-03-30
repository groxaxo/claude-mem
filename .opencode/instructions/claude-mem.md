# Claude-Mem Memory System

You have access to a persistent memory system that preserves context across coding sessions.

## How It Works

Claude-Mem automatically:
1. **Captures** tool usage and outputs during each OpenCode session
2. **Compresses** observations into semantic summaries using AI
3. **Retrieves** relevant context when starting new sessions
4. **Injects** memory context into your system prompt

## Memory Search Tools (via MCP)

You have access to powerful memory search tools:

- **`search`** - Search memory by query, with optional filters for type, date, and project
- **`timeline`** - Get chronological context around specific observations
- **`get_observations`** - Fetch full details for specific observation IDs

### Recommended Workflow

1. **Start broad**: Use `search` to find relevant observations (returns a compact index)
2. **Add context**: Use `timeline` to see what was happening around interesting results
3. **Get details**: Use `get_observations` with specific IDs for full information

This 3-layer approach saves tokens by only fetching full details when needed.

## Privacy Controls

Use `<private>content</private>` tags to exclude sensitive information from memory storage.
Anything inside these tags is stripped before being stored.

## Web Viewer

Access the memory viewer at http://localhost:37777 to:
- Browse all observations and summaries
- Search memory visually
- View session timelines
- Monitor worker service status

## Configuration

Memory settings are stored in `~/.claude-mem/settings.json`:
- AI model for compression (default: claude-3-5-haiku)
- Worker port (default: 37777, override with `CLAUDE_MEM_WORKER_PORT`)
- Worker host (default: 127.0.0.1, override with `CLAUDE_MEM_WORKER_HOST`)
- Installation path (override with `CLAUDE_MEM_INSTALL_DIR`)
- Context injection settings and log levels

## Important Notes

- Memory context is automatically injected — no manual action required
- The worker service must be running: `npm run worker:start` (in the claude-mem directory)
- All data is stored locally in `~/.claude-mem/`
- Memory persists across sessions and system restarts

