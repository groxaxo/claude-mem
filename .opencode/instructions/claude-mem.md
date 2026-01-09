# Claude-Mem Memory System

You have access to a persistent memory system that preserves context across coding sessions.

## How It Works

Claude-Mem automatically:
1. **Captures** your tool usage and observations during sessions
2. **Compresses** observations into semantic summaries using AI
3. **Retrieves** relevant context when starting new sessions
4. **Injects** memory context into your system prompts

## Memory Search Tools (via MCP)

You have access to powerful memory search tools:

- **`search`** - Search memory index with queries, filters by type/date/project
- **`timeline`** - Get chronological context around specific observations
- **`get_observations`** - Fetch full details for specific observation IDs

### Recommended Workflow

1. **Start broad**: Use `search` to find relevant observations (returns compact index)
2. **Add context**: Use `timeline` to see what was happening around interesting results
3. **Get details**: Use `get_observations` with specific IDs for full information

This 3-layer approach saves tokens by only fetching full details when needed.

## Privacy Controls

Use `<private>content</private>` tags to exclude sensitive information from memory storage.

## Web Viewer

Access the memory viewer at http://localhost:37777 to:
- Browse all observations and summaries
- Search memory visually
- View session timelines
- Monitor worker service status

## Citations

When referencing past work, you can cite observations by ID:
- View individual observations: http://localhost:37777/api/observation/{id}
- View all observations: http://localhost:37777

## Configuration

Memory settings are stored in `~/.claude-mem/settings.json`:
- AI model selection
- Worker port configuration
- Context injection settings
- Log levels

## Important Notes

- Memory context is automatically injected - no manual action required
- The worker service runs on port 37777 (configurable)
- All data is stored locally in `~/.claude-mem/`
- Memory persists across sessions and system restarts
