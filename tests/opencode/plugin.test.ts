/**
 * OpenCode Plugin Unit Tests
 *
 * Tests the ACTUAL `.opencode/plugin/claude-mem.ts` plugin by importing it
 * directly and stubbing `globalThis.fetch`, so any refactor of the plugin
 * is automatically reflected in test behaviour.
 *
 * Endpoint mapping verified:
 *   experimental.chat.system.transform  →  GET  /api/context/inject?projects=<name>
 *   chat.message (first in session)     →  POST /api/sessions/init
 *                                          POST /sessions/:id/init
 *   tool.execute.after                  →  POST /api/sessions/observations
 *   experimental.session.compacting     →  POST /api/sessions/summarize
 *
 * Note: `import type { Plugin }` in the plugin is erased at runtime by Bun's
 * TypeScript transpiler, so `@opencode-ai/plugin` does not need to be installed.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
// Import the real plugin under test. All imports inside the plugin that matter
// at runtime are Node.js built-ins (path, os, fs), so this always resolves.
import { ClaudeMemPlugin } from "../../.opencode/plugin/claude-mem.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE = "http://127.0.0.1:37777";
const DIRECTORY = "/projects/test-project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Builds a fake fetch implementation that records calls and returns
 * pre-configured responses keyed by URL (exact match first, then path-only).
 */
function makeFetchSpy(responses: Record<string, unknown> = {}) {
  const calls: FetchCall[] = [];

  const spy = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    const bodyText = init?.body ? String(init.body) : undefined;
    let body: unknown = undefined;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText; // leave as raw string if not valid JSON
      }
    }
    calls.push({ url: urlStr, method: init?.method ?? "GET", body });

    const key = urlStr.split("?")[0];
    const data = responses[urlStr] ?? responses[key] ?? {};
    return Promise.resolve(
      new Response(
        typeof data === "string" ? data : JSON.stringify(data),
        {
          status: 200,
          headers: { "Content-Type": typeof data === "string" ? "text/plain" : "application/json" },
        },
      ),
    );
  };

  return { spy, calls };
}

/**
 * Minimal plugin context.
 *
 * The `$` (BunShell) is only called inside `ensureWorkerRunning()` when a
 * worker script file is found on disk. In the test environment no such file
 * exists, so `resolveWorkerScript()` returns null and `$` is never invoked.
 */
function makeCtx() {
  return {
    directory: DIRECTORY,
    project: { name: "test-project" },
    worktree: DIRECTORY,
    serverUrl: new URL("http://localhost:4096"),
    client: {},
    $: Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
        quiet: () => Promise.resolve({ stdout: "", stderr: "" }),
      }),
      {},
    ),
  };
}

/**
 * Build a standard mock that includes `/api/readiness` so the plugin's
 * startup check succeeds without printing a warning, merged with any
 * test-specific responses.
 */
function makeReadyFetchSpy(extra: Record<string, unknown> = {}) {
  return makeFetchSpy({ [`${BASE}/api/readiness`]: {}, ...extra });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenCode Plugin – API endpoint mapping (real plugin)", () => {
  let savedFetch: typeof globalThis.fetch;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  it("system.transform calls GET /api/context/inject with projects query param", async () => {
    const contextText = "## Memory Context\n\nSome past work";
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/context/inject?projects=test-project`]: contextText,
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    const hookOutput = { system: [] as string[] };
    await (hooks as any)["experimental.chat.system.transform"]({}, hookOutput);

    const contextCall = calls.find(
      (c) => c.url.includes("/api/context/inject") && c.method === "GET",
    );
    expect(contextCall).toBeDefined();
    expect(contextCall!.url).toContain("projects=test-project");
    expect(hookOutput.system).toHaveLength(1);
    expect(hookOutput.system[0]).toContain(contextText);
  });

  it("system.transform does not push to system when worker returns empty", async () => {
    const { spy } = makeReadyFetchSpy({
      [`${BASE}/api/context/inject?projects=test-project`]: "",
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    const hookOutput = { system: [] as string[] };
    await (hooks as any)["experimental.chat.system.transform"]({}, hookOutput);
    expect(hookOutput.system).toHaveLength(0);
  });

  it("chat.message calls POST /api/sessions/init then POST /sessions/:id/init", async () => {
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 42, promptNumber: 1, skipped: false },
      [`${BASE}/sessions/42/init`]: { status: "initialized" },
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    const msgOutput = {
      message: { role: "user" },
      parts: [{ type: "text", text: "implement oauth login" }],
    };
    await (hooks as any)["chat.message"]({ sessionID: "s2" }, msgOutput);

    const initCall = calls.find(
      (c) => c.url === `${BASE}/api/sessions/init` && c.method === "POST",
    );
    expect(initCall).toBeDefined();
    expect((initCall!.body as any).contentSessionId).toBe("s2");
    expect((initCall!.body as any).project).toBe("test-project");
    expect((initCall!.body as any).prompt).toBe("implement oauth login");

    const agentCall = calls.find(
      (c) => c.url === `${BASE}/sessions/42/init` && c.method === "POST",
    );
    expect(agentCall).toBeDefined();
    expect((agentCall!.body as any).userPrompt).toBe("implement oauth login");
    expect((agentCall!.body as any).promptNumber).toBe(1);
  });

  it("chat.message does not re-init a session it has already seen", async () => {
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 99, promptNumber: 1, skipped: false },
      [`${BASE}/sessions/99/init`]: {},
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    const msgOutput = {
      message: { role: "user" },
      parts: [{ type: "text", text: "first msg" }],
    };

    await (hooks as any)["chat.message"]({ sessionID: "s-dedup" }, msgOutput);
    const countAfterFirst = calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length;

    await (hooks as any)["chat.message"]({ sessionID: "s-dedup" }, msgOutput);
    const countAfterSecond = calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length;

    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1); // no second init call
  });

  it("chat.message does not mark session initialized when message has no text parts", async () => {
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 5, promptNumber: 1, skipped: false },
      [`${BASE}/sessions/5/init`]: {},
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);

    // First call: empty parts → should NOT init and should NOT mark as seen
    await (hooks as any)["chat.message"]({ sessionID: "s-notext" }, { parts: [] });
    expect(calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length).toBe(0);

    // Second call: now has text → should init
    await (hooks as any)["chat.message"](
      { sessionID: "s-notext" },
      { parts: [{ type: "text", text: "hello" }] },
    );
    expect(calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length).toBe(1);
  });

  it("chat.message does not mark session initialized when parts contain only non-text types", async () => {
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 6, promptNumber: 1, skipped: false },
      [`${BASE}/sessions/6/init`]: {},
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);

    // First call: image part only → promptText remains empty, session should NOT be marked seen
    await (hooks as any)["chat.message"](
      { sessionID: "s-image" },
      { parts: [{ type: "image", url: "data:image/png;base64,abc" }] },
    );
    expect(calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length).toBe(0);

    // Second call: text part → should now initialize
    await (hooks as any)["chat.message"](
      { sessionID: "s-image" },
      { parts: [{ type: "text", text: "describe this image" }] },
    );
    expect(calls.filter((c) => c.url === `${BASE}/api/sessions/init`).length).toBe(1);
  });

  it("chat.message skips agent start when worker returns skipped=true", async () => {
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/sessions/init`]: { sessionDbId: 10, promptNumber: 1, skipped: true },
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    await (hooks as any)["chat.message"](
      { sessionID: "s-private" },
      { parts: [{ type: "text", text: "<private>secret</private>" }] },
    );

    const agentCall = calls.find(
      (c) =>
        c.url.includes("/sessions/") &&
        c.url.endsWith("/init") &&
        !c.url.endsWith("/api/sessions/init") &&
        c.method === "POST",
    );
    expect(agentCall).toBeUndefined();
  });

  it("tool.execute.after calls POST /api/sessions/observations with correct payload", async () => {
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/sessions/observations`]: { status: "queued" },
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    await (hooks as any)["tool.execute.after"](
      { tool: "bash", sessionID: "s3", callID: "call-abc", args: { command: "npm test" } },
      { title: "bash", output: "All tests passed", metadata: {} },
    );

    const obsCall = calls.find(
      (c) => c.url === `${BASE}/api/sessions/observations` && c.method === "POST",
    );
    expect(obsCall).toBeDefined();
    const body = obsCall!.body as any;
    expect(body.contentSessionId).toBe("s3");
    expect(body.tool_name).toBe("bash");
    expect(body.tool_input).toEqual({ command: "npm test" });
    expect(body.tool_response).toBe("All tests passed");
    expect(body.cwd).toBe(DIRECTORY);
  });

  it("tool.execute.after does nothing when sessionID is missing", async () => {
    const { spy, calls } = makeReadyFetchSpy();
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    await (hooks as any)["tool.execute.after"](
      { tool: "bash", sessionID: undefined, callID: "x", args: {} },
      { title: "bash", output: "out", metadata: {} },
    );

    expect(calls.filter((c) => c.url.includes("/api/sessions/observations"))).toHaveLength(0);
  });

  it("experimental.session.compacting calls POST /api/sessions/summarize", async () => {
    const { spy, calls } = makeReadyFetchSpy({
      [`${BASE}/api/sessions/summarize`]: { status: "queued" },
    });
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    const compactionOutput = { context: [] as string[], prompt: undefined as string | undefined };
    await (hooks as any)["experimental.session.compacting"]({ sessionID: "s4" }, compactionOutput);

    const summaryCall = calls.find(
      (c) => c.url === `${BASE}/api/sessions/summarize` && c.method === "POST",
    );
    expect(summaryCall).toBeDefined();
    expect((summaryCall!.body as any).contentSessionId).toBe("s4");
    expect(compactionOutput.context).toHaveLength(1);
    expect(compactionOutput.context[0]).toContain("claude-mem");
  });

  it("experimental.session.compacting does nothing when sessionID is missing", async () => {
    const { spy, calls } = makeReadyFetchSpy();
    globalThis.fetch = spy as any;

    const hooks = await ClaudeMemPlugin(makeCtx() as any);
    const compactionOutput = { context: [] as string[] };
    await (hooks as any)["experimental.session.compacting"]({ sessionID: undefined }, compactionOutput);

    expect(calls.filter((c) => c.url.includes("/summarize"))).toHaveLength(0);
    expect(compactionOutput.context).toHaveLength(0);
  });
});

