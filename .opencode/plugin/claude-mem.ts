/**
 * Claude-Mem OpenCode Plugin
 *
 * Integrates claude-mem's persistent memory system with OpenCode.
 * Captures tool usage, compresses observations into semantic summaries,
 * and injects relevant context at the start of each session.
 *
 * Worker API endpoints used:
 *   GET  /api/context/inject?projects=<name>  – Fetch pre-formatted context
 *   POST /api/sessions/init                   – Init session + save user prompt
 *   POST /sessions/:id/init                   – Start the background SDK agent
 *   POST /api/sessions/observations           – Save tool observations
 *   POST /api/sessions/summarize              – Trigger end-of-session summary
 *   GET  /api/readiness                       – Check if worker is fully ready
 *
 * Lifecycle hooks used:
 *   experimental.chat.system.transform – Inject memory context into system prompt
 *   chat.message                       – Initialize session on first user message
 *   tool.execute.after                 – Capture every tool execution
 *   experimental.session.compacting    – Trigger summary before compaction
 */

import type { Plugin } from "@opencode-ai/plugin";
import { join, basename } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export const ClaudeMemPlugin: Plugin = async (ctx) => {
  const { directory, project, $ } = ctx;

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const WORKER_PORT = process.env.CLAUDE_MEM_WORKER_PORT || "37777";
  const WORKER_HOST = process.env.CLAUDE_MEM_WORKER_HOST || "127.0.0.1";
  const WORKER_BASE_URL = `http://${WORKER_HOST}:${WORKER_PORT}`;

  // Project name extracted from the working directory (e.g. "my-project")
  const projectName = basename(directory);

  // Session state: tracks which OpenCode sessions have been initialized
  const initializedSessions = new Set<string>();

  // ---------------------------------------------------------------------------
  // Worker helpers
  // ---------------------------------------------------------------------------

  /** Returns true when the worker service is up and fully ready */
  async function isWorkerReady(): Promise<boolean> {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/readiness`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the absolute path to worker-service.cjs.
   *
   * Search order:
   *   1. CLAUDE_MEM_INSTALL_DIR env var
   *   2. Two directories above this plugin file (claude-mem repo layout)
   *   3. Claude Code marketplace install: ~/.claude/plugins/marketplaces/thedotmack
   */
  function resolveWorkerScript(): string | null {
    const candidates: string[] = [];

    if (process.env.CLAUDE_MEM_INSTALL_DIR) {
      candidates.push(
        join(process.env.CLAUDE_MEM_INSTALL_DIR, "plugin", "scripts", "worker-service.cjs"),
      );
    }

    // .opencode/plugin/claude-mem.ts → two levels up is the claude-mem root
    try {
      const pluginDir = join(directory, ".opencode", "plugin");
      candidates.push(join(pluginDir, "..", "..", "plugin", "scripts", "worker-service.cjs"));
    } catch {
      // ignore
    }

    // Claude Code marketplace path
    candidates.push(
      join(homedir(), ".claude", "plugins", "marketplaces", "thedotmack", "plugin", "scripts", "worker-service.cjs"),
    );

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  /** Start the claude-mem worker service if it is not yet running */
  async function ensureWorkerRunning(): Promise<void> {
    if (await isWorkerReady()) return;

    const workerScript = resolveWorkerScript();
    if (!workerScript) {
      console.warn(
        "[claude-mem] Worker service is not running and could not be located.\n" +
          "  Please start it manually: npm run worker:start\n" +
          "  Or set CLAUDE_MEM_INSTALL_DIR to the claude-mem installation directory.",
      );
      return;
    }

    try {
      await $`bun ${workerScript} start`.quiet();
      // Allow the service a moment to initialise before checking readiness
      const WORKER_STARTUP_DELAY_MS = 500;
      await new Promise<void>((resolve) => setTimeout(resolve, WORKER_STARTUP_DELAY_MS));
    } catch (err) {
      console.warn("[claude-mem] Failed to start worker service:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Memory helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch pre-formatted memory context for the current project.
   * Returns the context as a plain-text string, or "" on failure.
   */
  async function fetchMemoryContext(): Promise<string> {
    try {
      const url =
        `${WORKER_BASE_URL}/api/context/inject` +
        `?projects=${encodeURIComponent(projectName)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return "";
      const text = await res.text();
      return text.trim();
    } catch {
      return "";
    }
  }

  /**
   * Initialize a session in the worker database and start the background agent.
   * Mirrors the two-step flow used by claude-mem's new-hook.ts.
   */
  async function initSession(sessionID: string, prompt: string): Promise<void> {
    // Step 1: create / retrieve the DB session and save the user prompt
    const initRes = await fetch(`${WORKER_BASE_URL}/api/sessions/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentSessionId: sessionID, project: projectName, prompt }),
    });

    if (!initRes.ok) {
      console.warn(`[claude-mem] Session init failed: ${initRes.status}`);
      return;
    }

    const { sessionDbId, promptNumber, skipped } = await initRes.json();

    if (skipped) return; // entire prompt was inside <private> tags

    // Step 2: start the background memory-agent for this session
    await fetch(`${WORKER_BASE_URL}/sessions/${sessionDbId}/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPrompt: prompt, promptNumber }),
    }).catch(() => {
      // Agent start is best-effort; observations will still be queued
    });
  }

  /**
   * Send a tool observation to the worker for storage and compression.
   * Mirrors the flow used by claude-mem's save-hook.ts.
   */
  async function saveObservation(
    sessionID: string,
    toolName: string,
    toolInput: unknown,
    toolOutput: string,
  ): Promise<void> {
    try {
      await fetch(`${WORKER_BASE_URL}/api/sessions/observations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentSessionId: sessionID,
          tool_name: toolName,
          tool_input: toolInput,
          tool_response: toolOutput,
          cwd: directory,
        }),
      });
    } catch {
      // Fire-and-forget; memory capture failures must not interrupt coding
    }
  }

  /**
   * Queue a summary request at the end of the session.
   * Mirrors the flow used by claude-mem's summary-hook.ts.
   */
  async function requestSummary(sessionID: string, lastAssistantMessage?: string): Promise<void> {
    try {
      await fetch(`${WORKER_BASE_URL}/api/sessions/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentSessionId: sessionID,
          last_assistant_message: lastAssistantMessage || "",
        }),
      });
    } catch {
      // Best-effort
    }
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------
  await ensureWorkerRunning();

  // ---------------------------------------------------------------------------
  // Plugin hooks
  // ---------------------------------------------------------------------------
  return {
    /**
     * Inject memory context into the system prompt.
     * Called by OpenCode before each LLM request, equivalent to claude-mem's
     * SessionStart / context-hook.
     */
    "experimental.chat.system.transform": async (_input, output) => {
      const ctx = await fetchMemoryContext();
      if (ctx) {
        output.system.push("\n" + ctx);
      }
    },

    /**
     * Initialize the session when the first user message arrives.
     * This is the OpenCode equivalent of claude-mem's UserPromptSubmit / new-hook.
     *
     * Extracts the prompt text from message parts, stores it in the worker DB,
     * and starts the background memory agent.
     */
    "chat.message": async (input, output) => {
      const { sessionID } = input;
      if (!sessionID || initializedSessions.has(sessionID)) return;
      initializedSessions.add(sessionID);

      // Extract user prompt text from message parts
      let promptText = "";
      for (const part of output.parts) {
        if (part.type === "text") {
          promptText += part.text;
        }
      }
      if (!promptText.trim()) return;

      await initSession(sessionID, promptText.trim());
    },

    /**
     * Capture every tool execution as an observation.
     * This is the OpenCode equivalent of claude-mem's PostToolUse / save-hook.
     *
     * The `args` field is available in input since opencode ≥0.1.x.
     */
    "tool.execute.after": async (input, output) => {
      const { tool, sessionID, args } = input;
      if (!sessionID) return;

      await saveObservation(sessionID, tool, args, output.output);
    },

    /**
     * Trigger session summary before compaction.
     * This is the OpenCode equivalent of claude-mem's Stop / summary-hook.
     *
     * The hook receives the sessionID and can append context strings that
     * will be included in the compaction prompt.
     */
    "experimental.session.compacting": async (input, output) => {
      const { sessionID } = input;
      if (!sessionID) return;

      await requestSummary(sessionID);

      // Optionally remind the compacted context about the memory system
      output.context.push(
        "This session's observations have been saved to claude-mem for future reference.",
      );
    },
  };
};

// Export as default so OpenCode can load the plugin automatically
export default ClaudeMemPlugin;
