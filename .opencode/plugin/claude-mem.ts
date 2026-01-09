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
     * Inject memory context into system prompts
     * This hook modifies the system prompt to include relevant memory context
     */
    "experimental.chat.system.transform": async (input, output) => {
      // Only inject context if we have a valid session
      const sessionID = crypto.randomUUID(); // OpenCode should provide this
      
      const memoryContext = await getMemoryContext(sessionID);
      
      if (memoryContext.length > 0) {
        output.system.push(
          "\n# Claude-Mem Context\n\n" +
          "The following context is retrieved from previous sessions:\n\n" +
          memoryContext.join("\n\n")
        );
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
        },
      });
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
  };
};

// Export as default for OpenCode plugin loading
export default ClaudeMemPlugin;
