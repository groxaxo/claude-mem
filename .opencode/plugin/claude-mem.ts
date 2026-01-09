/**
 * Claude-Mem OpenCode Plugin
 * 
 * This plugin integrates claude-mem's persistent memory system with OpenCode.
 * It provides memory compression and context retrieval across coding sessions.
 * 
 * Features:
 * - Automatic session observation capture
 * - Semantic memory compression
 * - Context injection at session start
 * - Search tools via MCP integration
 */

import type { Plugin } from "@opencode-ai/plugin";

export const ClaudeMemPlugin: Plugin = async (ctx) => {
  const { client, project, directory, worktree, serverUrl, $ } = ctx;

  // Worker service configuration
  const WORKER_PORT = process.env.CLAUDE_MEM_WORKER_PORT || "37777";
  const WORKER_HOST = process.env.CLAUDE_MEM_WORKER_HOST || "localhost";
  const WORKER_BASE_URL = `http://${WORKER_HOST}:${WORKER_PORT}`;

  // Track sessions to inject context only once per session
  const sessionsWithContext = new Set<string>();

  /**
   * Check if worker service is running
   */
  async function isWorkerRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${WORKER_BASE_URL}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start worker service if not running
   */
  async function ensureWorkerRunning(): Promise<void> {
    const running = await isWorkerRunning();
    if (!running) {
      console.log("[claude-mem] Starting worker service...");
      // Try to start the worker using the installed service
      try {
        await $`bun plugin/scripts/worker-service.cjs start`.quiet();
      } catch (error) {
        console.warn("[claude-mem] Could not start worker service automatically:", error);
        console.log("[claude-mem] Please start it manually: npm run worker:start");
      }
    }
  }

  /**
   * Get context from worker service
   */
  async function getMemoryContext(sessionID: string): Promise<string[]> {
    try {
      const response = await fetch(`${WORKER_BASE_URL}/api/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionID,
          workingDirectory: directory,
        }),
      });

      if (!response.ok) {
        console.warn(`[claude-mem] Failed to fetch context: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.context || [];
    } catch (error) {
      console.warn("[claude-mem] Error fetching memory context:", error);
      return [];
    }
  }

  /**
   * Save observation to memory
   */
  async function saveObservation(data: {
    sessionId: string;
    tool: string;
    args: any;
    output: string;
    metadata?: any;
  }): Promise<void> {
    try {
      await fetch(`${WORKER_BASE_URL}/api/observation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.warn("[claude-mem] Error saving observation:", error);
    }
  }

  // Ensure worker is running on plugin load
  await ensureWorkerRunning();

  return {
    /**
     * Capture new messages to track session state
     * This allows us to inject context at the right time
     */
    "chat.message": async (input, output) => {
      const { sessionID } = input;
      
      // Track that we've seen this session
      if (sessionID && !sessionsWithContext.has(sessionID)) {
        sessionsWithContext.add(sessionID);
        console.log(`[claude-mem] New session started: ${sessionID}`);
      }
    },

    /**
     * Inject memory context into system prompts
     * This hook modifies the system prompt to include relevant memory context
     */
    "experimental.chat.system.transform": async (input, output) => {
      // Since this hook doesn't get sessionID, we'll inject context for all sessions
      // The context API will handle deduplication on the server side
      
      // Use a session identifier based on the working directory
      // This is a workaround until we can track the actual session ID
      const sessionID = `opencode-${directory}`;
      
      const memoryContext = await getMemoryContext(sessionID);
      
      if (memoryContext.length > 0) {
        output.system.push(
          "\n# Claude-Mem Context\n\n" +
          "The following context is retrieved from previous sessions:\n\n" +
          memoryContext.join("\n\n")
        );
        console.log(`[claude-mem] Injected ${memoryContext.length} context items`);
      }
    },

    /**
     * Capture tool executions for memory
     * This hook runs after tool execution to save observations
     */
    "tool.execute.after": async (input, output) => {
      const { tool, sessionID, callID } = input;
      const { title, output: toolOutput, metadata } = output;

      // Save tool execution to memory
      await saveObservation({
        sessionId: sessionID,
        tool,
        args: { callID }, // OpenCode doesn't expose args in after hook
        output: toolOutput,
        metadata: {
          ...metadata,
          title,
          timestamp: new Date().toISOString(),
          directory,
          project: project.name,
        },
      });
    },

    /**
     * Capture tool execution arguments before execution
     * This gives us access to the actual arguments
     */
    "tool.execute.before": async (input, output) => {
      // We could use this to capture arguments if needed
      // For now, we just track it
      const { tool, sessionID, callID } = input;
      console.log(`[claude-mem] Tool executing: ${tool} (session: ${sessionID})`);
    },

    /**
     * Handle configuration updates
     */
    config: async (config) => {
      // Could customize claude-mem behavior based on OpenCode config
      if (config.instructions) {
        console.log("[claude-mem] Loaded with instructions from:", config.instructions);
      }
    },

    /**
     * Handle global events for debugging
     */
    event: async ({ event }) => {
      // Log events for debugging
      if (event.type === "session.start") {
        console.log("[claude-mem] Session started event");
      }
    },
  };
};

// Export as default for OpenCode plugin loading
export default ClaudeMemPlugin;
