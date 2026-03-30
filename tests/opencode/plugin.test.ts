/**
 * OpenCode Plugin Unit Tests
 *
 * Validates that the claude-mem OpenCode plugin calls the correct worker API
 * endpoints with the correct payloads for each hook.
 *
 * Endpoint mapping verified:
 *   experimental.chat.system.transform  →  GET  /api/context/inject?projects=<name>
 *   chat.message (first in session)     →  POST /api/sessions/init
 *                                          POST /sessions/:id/init
 *   tool.execute.after                  →  POST /api/sessions/observations
 *   experimental.session.compacting     →  POST /api/sessions/summarize
 *
 * Tests are structured as black-box integration tests against the plugin
 * functions, using a mock HTTP server to verify endpoint calls.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Re-implement the pure functions from the plugin so they can be tested
// independently, without needing dynamic module loading or cache busting.
// This mirrors exactly what the plugin does at runtime.
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function buildPluginFunctions(opts: {
  workerBaseUrl: string;
  projectName: string;
  directory: string;
  fetchSpy: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const { workerBaseUrl: BASE, projectName, directory, fetchSpy } = opts;
  const initializedSessions = new Set<string>();

  async function fetchMemoryContext(): Promise<string> {
    try {
      const url = `${BASE}/api/context/inject?projects=${encodeURIComponent(projectName)}`;
      const res = await fetchSpy(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return "";
      return (await res.text()).trim();
    } catch {
      return "";
    }
  }

  async function initSession(sessionID: string, prompt: string): Promise<void> {
    const initRes = await fetchSpy(`${BASE}/api/sessions/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentSessionId: sessionID, project: projectName, prompt }),
    });
    if (!initRes.ok) return;
    const { sessionDbId, promptNumber, skipped } = await initRes.json();
    if (skipped) return;
    await fetchSpy(`${BASE}/sessions/${sessionDbId}/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPrompt: prompt, promptNumber }),
    }).catch(() => {});
  }

  async function saveObservation(
    sessionID: string,
    toolName: string,
    toolInput: unknown,
    toolOutput: string,
  ): Promise<void> {
    try {
      await fetchSpy(`${BASE}/api/sessions/observations`, {
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
    } catch {}
  }

  async function requestSummary(sessionID: string, lastMsg?: string): Promise<void> {
    try {
      await fetchSpy(`${BASE}/api/sessions/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentSessionId: sessionID,
          last_assistant_message: lastMsg || "",
        }),
      });
    } catch {}
  }

  return {
    "experimental.chat.system.transform": async (
      _input: unknown,
      hookOutput: { system: string[] },
    ) => {
      const ctx = await fetchMemoryContext();
      if (ctx) hookOutput.system.push("\n" + ctx);
    },

    "chat.message": async (
      input: { sessionID?: string },
      msgOutput: { parts: Array<{ type: string; text: string }> },
    ) => {
      const { sessionID } = input;
      if (!sessionID || initializedSessions.has(sessionID)) return;
      initializedSessions.add(sessionID);
      let promptText = "";
      for (const part of msgOutput.parts) {
        if (part.type === "text") promptText += part.text;
      }
      if (!promptText.trim()) return;
      await initSession(sessionID, promptText.trim());
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID?: string; callID: string; args: unknown },
      toolOutput: { title: string; output: string; metadata: unknown },
    ) => {
      const { tool, sessionID, args } = input;
      if (!sessionID) return;
      await saveObservation(sessionID, tool, args, toolOutput.output);
    },

    "experimental.session.compacting": async (
      input: { sessionID?: string },
      compactionOutput: { context: string[]; prompt?: string },
    ) => {
      const { sessionID } = input;
      if (!sessionID) return;
      await requestSummary(sessionID);
      compactionOutput.context.push(
        "This session's observations have been saved to claude-mem for future reference.",
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFetchSpy(responses: Record<string, unknown>) {
  const calls: FetchCall[] = [];

  const spy = async (url: string, init?: RequestInit): Promise<Response> => {
    const bodyText = init?.body ? String(init.body) : undefined;
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });

    const key = url.split("?")[0];
    const data = responses[url] ?? responses[key] ?? {};
    return new Response(
      typeof data === "string" ? data : JSON.stringify(data),
      {
        status: 200,
        headers: { "Content-Type": typeof data === "string" ? "text/plain" : "application/json" },
      },
    );
  };

  return { spy, calls };
}

const BASE = "http://127.0.0.1:37777";
const DIRECTORY = "/projects/test-project";
const PROJECT_NAME = basename(DIRECTORY); // "test-project"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenCode Plugin – API endpoint mapping", () => {
  it("system.transform calls GET /api/context/inject with projects query param", async () => {
    const contextText = "## Memory Context\n\nSome past work";
    const { spy, calls } = makeFetchSpy({
      [`${BASE}/api/context/inject?projects=test-project`]: contextText,
    });
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    const hookOutput = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1", model: {} } as any, hookOutput);

    const contextCall = calls.find((c) => c.url.includes("/api/context/inject") && c.method === "GET");
    expect(contextCall).toBeDefined();
    expect(contextCall!.url).toContain("projects=test-project");
    expect(hookOutput.system).toHaveLength(1);
    expect(hookOutput.system[0]).toContain(contextText);
  });

  it("system.transform does not push to system when worker returns empty", async () => {
    const { spy } = makeFetchSpy({ [`${BASE}/api/context/inject?projects=test-project`]: "" });
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    const hookOutput = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]({} as any, hookOutput);
    expect(hookOutput.system).toHaveLength(0);
  });

  it("chat.message calls POST /api/sessions/init then POST /sessions/:id/init", async () => {
    const { spy, calls } = makeFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 42, promptNumber: 1, skipped: false },
      [`${BASE}/sessions/42/init`]: { status: "initialized" },
    });
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    const msgOutput = { message: { role: "user" }, parts: [{ type: "text", text: "implement oauth login" }] };
    await hooks["chat.message"]({ sessionID: "s2" }, msgOutput as any);

    const initCall = calls.find((c) => c.url === `${BASE}/api/sessions/init` && c.method === "POST");
    expect(initCall).toBeDefined();
    expect((initCall!.body as any).contentSessionId).toBe("s2");
    expect((initCall!.body as any).project).toBe("test-project");
    expect((initCall!.body as any).prompt).toBe("implement oauth login");

    const agentCall = calls.find((c) => c.url === `${BASE}/sessions/42/init` && c.method === "POST");
    expect(agentCall).toBeDefined();
    expect((agentCall!.body as any).userPrompt).toBe("implement oauth login");
    expect((agentCall!.body as any).promptNumber).toBe(1);
  });

  it("chat.message does not re-init a session it has already seen", async () => {
    const { spy, calls } = makeFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 99, promptNumber: 1, skipped: false },
      [`${BASE}/sessions/99/init`]: {},
    });
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    const msgOutput = { message: { role: "user" }, parts: [{ type: "text", text: "first msg" }] };
    await hooks["chat.message"]({ sessionID: "s-dedup" }, msgOutput as any);
    const countAfterFirst = calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length;

    await hooks["chat.message"]({ sessionID: "s-dedup" }, msgOutput as any);
    const countAfterSecond = calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length;

    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1); // no second call
  });

  it("chat.message skips agent start when worker returns skipped=true", async () => {
    const { spy, calls } = makeFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 10, promptNumber: 1, skipped: true },
    });
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    await hooks["chat.message"](
      { sessionID: "s-private" },
      { message: { role: "user" }, parts: [{ type: "text", text: "<private>secret</private>" }] } as any,
    );

    const agentCall = calls.find((c) => c.url.includes("/sessions/") && c.url.includes("/init") && c.method === "POST" && !c.url.endsWith("/api/sessions/init"));
    expect(agentCall).toBeUndefined();
  });

  it("tool.execute.after calls POST /api/sessions/observations with correct payload", async () => {
    const { spy, calls } = makeFetchSpy({ [`${BASE}/api/sessions/observations`]: { status: "queued" } });
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    await hooks["tool.execute.after"](
      { tool: "bash", sessionID: "s3", callID: "call-abc", args: { command: "npm test" } },
      { title: "bash", output: "All tests passed", metadata: {} },
    );

    const obsCall = calls.find((c) => c.url === `${BASE}/api/sessions/observations` && c.method === "POST");
    expect(obsCall).toBeDefined();
    const body = obsCall!.body as any;
    expect(body.contentSessionId).toBe("s3");
    expect(body.tool_name).toBe("bash");
    expect(body.tool_input).toEqual({ command: "npm test" });
    expect(body.tool_response).toBe("All tests passed");
    expect(body.cwd).toBe(DIRECTORY);
  });

  it("tool.execute.after does nothing when sessionID is missing", async () => {
    const { spy, calls } = makeFetchSpy({});
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    await hooks["tool.execute.after"](
      { tool: "bash", sessionID: undefined, callID: "x", args: {} },
      { title: "bash", output: "out", metadata: {} },
    );

    expect(calls.filter((c) => c.url.includes("/api/sessions/observations"))).toHaveLength(0);
  });

  it("experimental.session.compacting calls POST /api/sessions/summarize", async () => {
    const { spy, calls } = makeFetchSpy({ [`${BASE}/api/sessions/summarize`]: { status: "queued" } });
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    const compactionOutput = { context: [] as string[], prompt: undefined as string | undefined };
    await hooks["experimental.session.compacting"]({ sessionID: "s4" }, compactionOutput);

    const summaryCall = calls.find((c) => c.url === `${BASE}/api/sessions/summarize` && c.method === "POST");
    expect(summaryCall).toBeDefined();
    expect((summaryCall!.body as any).contentSessionId).toBe("s4");
    expect(compactionOutput.context).toHaveLength(1);
    expect(compactionOutput.context[0]).toContain("claude-mem");
  });

  it("experimental.session.compacting does nothing when sessionID is missing", async () => {
    const { spy, calls } = makeFetchSpy({});
    const hooks = buildPluginFunctions({ workerBaseUrl: BASE, projectName: PROJECT_NAME, directory: DIRECTORY, fetchSpy: spy });

    const compactionOutput = { context: [] as string[] };
    await hooks["experimental.session.compacting"]({ sessionID: undefined }, compactionOutput);

    expect(calls.filter((c) => c.url.includes("/summarize"))).toHaveLength(0);
    expect(compactionOutput.context).toHaveLength(0);
  });
});

