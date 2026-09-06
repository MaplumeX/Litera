import { describe, expect, it, vi } from "vitest";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, type RuntimeConfig } from "./embedded-runtime";
import { sessionNavigation, visibleMessages } from "@/agent/sessions/pi-session";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";
import type { AgentEvent } from "@/types/agent";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistantBase = { api: "openai-completions" as const, provider: "custom-a", model: "model-a", usage, stopReason: "stop" };

/**
 * Session with one fork at the root (created by editing the first message):
 *
 *   u1  "first question"        (parent null) ── a1 "first answer"
 *   u1b "edited first question" (parent null) ── a1b "new answer"   <- leafId
 */
function forkedSession(): DecodedPiSession {
  return {
    header: { type: "session", version: 3, id: "session-1", timestamp: "2026-08-14T00:00:00Z", cwd: "" },
    entries: [
      { type: "message", id: "u1", parentId: null, timestamp: "2026-08-14T00:00:01Z", message: { role: "user", content: "first question", timestamp: 1 } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-14T00:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "first answer" }], ...assistantBase, timestamp: 2 } },
      { type: "message", id: "u1b", parentId: null, timestamp: "2026-08-14T00:00:03Z", message: { role: "user", content: "edited first question", timestamp: 3 } },
      { type: "message", id: "a1b", parentId: "u1b", timestamp: "2026-08-14T00:00:04Z", message: { role: "assistant", content: [{ type: "text", text: "new answer" }], ...assistantBase, timestamp: 4 } },
    ],
    leafId: "a1b",
  };
}

interface Harness {
  runtime: LiteraAgentRuntime;
  events: AgentEvent[];
  appends: Array<{ expected: string | null; entries: PiSessionEntry[] }>;
  setLeafCalls: Array<{ sessionId: string; leafId: string }>;
  session: DecodedPiSession;
  unsubscribe: () => void;
}

async function harness(session: DecodedPiSession, responses: string[], loadConfig?: () => Promise<RuntimeConfig>): Promise<Harness> {
  const events: AgentEvent[] = [];
  const appends: Array<{ expected: string | null; entries: PiSessionEntry[] }> = [];
  const setLeafCalls: Array<{ sessionId: string; leafId: string }> = [];
  const sessions: SessionPort = {
    create: async () => session,
    list: async () => [],
    load: async () => session,
    setLeaf: async (_book, sessionId, leafId) => {
      setLeafCalls.push({ sessionId, leafId });
      return { ...session, leafId };
    },
    delete: async () => {},
    append: async (_book, _session, expected, entries) => {
      appends.push({ expected, entries });
      return entries.at(-1)?.id ?? null;
    },
  };
  const book: BookContentPort = {
    open: async () => {},
    metadata: async () => ({ title: "T", author: "A", language: "en", totalChapters: 1 }),
    toc: async () => [],
    readChapter: async () => ({ chapterIndex: 0, chapterNumber: 1, part: 0, totalParts: 1, text: "chapter" }),
    search: async () => [],
    close: () => {},
  };
  const faux = createFauxCore({ tokensPerSecond: 10_000 });
  faux.setResponses(responses.map((text) => fauxAssistantMessage(text)));
  const config: RuntimeConfig = { provider: "custom-a", model: "model-a", api: faux.api, baseUrl: "https://example.test/v1", apiKey: "secret", thinkingLevel: "off" };
  const runtime = new LiteraAgentRuntime({ sessions, book, loadConfig: loadConfig ?? (async () => config), loadStream: async () => faux.streamSimple });
  const unsubscribe = runtime.subscribe((event) => events.push(event));
  await runtime.openBook("book", new ArrayBuffer(1));
  await runtime.switchSession("session-1");
  return { runtime, events, appends, setLeafCalls, session, unsubscribe };
}

describe("LiteraAgentRuntime branch switching", () => {
  it("switchBranch persists the leaf, updates the in-memory session, and emits branch_switched", async () => {
    const current = forkedSession();
    const { runtime, events, setLeafCalls, unsubscribe } = await harness(current, []);

    await runtime.switchBranch("session-1", "a1");

    expect(setLeafCalls).toEqual([{ sessionId: "session-1", leafId: "a1" }]);
    const switched = events.find((event) => event.type === "branch_switched");
    expect(switched).toBeTruthy();
    if (switched?.type !== "branch_switched") return;
    // The whole visible flow flips to the old branch.
    expect(switched.messages).toEqual([
      { role: "user", content: "first question" },
      expect.objectContaining({ role: "assistant", content: "first answer" }),
    ]);
    expect(switched.anchors).toEqual(["u1", "a1"]);
    const expectedInfo = {
      options: [
        { anchorId: "u1", preview: "first question" },
        { anchorId: "u1b", preview: "edited first question" },
      ],
      activeIndex: 0,
    };
    expect(switched.navigation).toEqual({ u1: expectedInfo, u1b: expectedInfo });
    unsubscribe();
  });

  it("rejects switchBranch while a prompt is streaming and never calls setLeaf", async () => {
    const current = forkedSession();
    let releaseConfig: (value: RuntimeConfig) => void = () => {};
    const configPromise = new Promise<RuntimeConfig>((resolve) => { releaseConfig = resolve; });
    const { runtime, setLeafCalls, unsubscribe } = await harness(current, ["gated answer"], () => configPromise);

    const promptPromise = runtime.prompt("question", {}, "prompt-1");
    await Promise.resolve();
    await expect(runtime.switchBranch("session-1", "a1")).rejects.toThrow("already active");
    expect(setLeafCalls).toHaveLength(0);

    releaseConfig({ provider: "custom-a", model: "model-a", api: "openai-completions", baseUrl: "https://example.test/v1", apiKey: "secret", thinkingLevel: "off" });
    await promptPromise;
    unsubscribe();
  });

  it("rejects switchBranch for an unknown leaf or a non-active session", async () => {
    const current = forkedSession();
    const { runtime, setLeafCalls, unsubscribe } = await harness(current, []);

    await expect(runtime.switchBranch("session-1", "ghost")).rejects.toThrow("not in the session");
    await expect(runtime.switchBranch("other-session", "a1")).rejects.toThrow("not active");
    expect(setLeafCalls).toHaveLength(0);
    unsubscribe();
  });

  it("continues a prompt on the switched old branch under its leaf", async () => {
    const current = forkedSession();
    const { runtime, events, appends, unsubscribe } = await harness(current, ["follow answer"]);

    await runtime.switchBranch("session-1", "a1");
    await runtime.prompt("continue", {}, "prompt-2");

    // The race check uses the old branch's durable leaf, and the new entries
    // grow below it (model_change/snapshot/user chain rooted at a1).
    expect(appends[0].expected).toBe("a1");
    expect(appends[0].entries[0].parentId).toBe("a1");
    const persistedUser = appends[0].entries.find((entry) => entry.type === "message" && (entry.message as { role?: string }).role === "user");
    expect(persistedUser?.message).toMatchObject({ role: "user", content: "continue" });

    // prompt_end carries the full post-prompt projection with navigation.
    const promptEnd = events.find((event) => event.type === "prompt_end");
    expect(promptEnd?.type === "prompt_end" && promptEnd.messages?.map((message) => message.content)).toEqual([
      "first question",
      "first answer",
      "continue",
      "follow answer",
    ]);
    if (promptEnd?.type === "prompt_end") {
      expect(promptEnd.anchors).toHaveLength(4);
      expect(promptEnd.anchors?.[0]).toBe("u1");
      expect(promptEnd.anchors?.[1]).toBe("a1");
      // Still on the u1 branch of the root fork.
      expect(promptEnd.navigation?.u1).toMatchObject({ activeIndex: 0 });
      expect(promptEnd.navigation?.u1.options).toHaveLength(2);
    }
    unsubscribe();
  });

  it("emits an error event when setLeaf fails", async () => {
    const current = forkedSession();
    const events: AgentEvent[] = [];
    const sessions: SessionPort = {
      create: async () => current,
      list: async () => [],
      load: async () => current,
      setLeaf: async () => { throw new Error("storage down"); },
      delete: async () => {},
      append: async () => null,
    };
    const book: BookContentPort = {
      open: async () => {},
      metadata: async () => ({ title: "T", author: "A", language: "en", totalChapters: 1 }),
      toc: async () => [],
      readChapter: async () => ({ chapterIndex: 0, chapterNumber: 1, part: 0, totalParts: 1, text: "chapter" }),
      search: async () => [],
      close: () => {},
    };
    const faux = createFauxCore({ tokensPerSecond: 10_000 });
    const config: RuntimeConfig = { provider: "custom-a", model: "model-a", api: faux.api, baseUrl: "https://example.test/v1", apiKey: "secret", thinkingLevel: "off" };
    const runtime = new LiteraAgentRuntime({ sessions, book, loadConfig: async () => config, loadStream: async () => faux.streamSimple });
    const unsubscribe = runtime.subscribe((event) => events.push(event));
    await runtime.openBook("book", new ArrayBuffer(1));
    await runtime.switchSession("session-1");

    await expect(runtime.switchBranch("session-1", "a1")).rejects.toThrow("storage down");
    const error = events.find((event) => event.type === "error");
    expect(error?.type === "error" && error.message).toBe("storage down");
    expect(error?.type === "error" && error.sessionId).toBe("session-1");
    unsubscribe();
  });

  it("prompt_aborted after an edit carries the persisted-entry projection (deltas ≡ payload)", async () => {
    const current = forkedSession();
    // Abort mid-stream: a slow response lets deltas land before the abort.
    const faux = createFauxCore({ tokensPerSecond: 1 });
    faux.setResponses([fauxAssistantMessage("aborted partial answer")]);
    const events: AgentEvent[] = [];
    const sessions: SessionPort = {
      create: async () => current,
      list: async () => [],
      load: async () => current,
      setLeaf: async (_book, sessionId, leafId) => ({ ...current, leafId }),
      delete: async () => {},
      append: async (_book, _session, _leaf, entries) => entries.at(-1)?.id ?? null,
    };
    const book: BookContentPort = {
      open: async () => {},
      metadata: async () => ({ title: "T", author: "A", language: "en", totalChapters: 1 }),
      toc: async () => [],
      readChapter: async () => ({ chapterIndex: 0, chapterNumber: 1, part: 0, totalParts: 1, text: "chapter" }),
      search: async () => [],
      close: () => {},
    };
    const config: RuntimeConfig = { provider: "custom-a", model: "model-a", api: faux.api, baseUrl: "https://example.test/v1", apiKey: "secret", thinkingLevel: "off" };
    const runtime = new LiteraAgentRuntime({ sessions, book, loadConfig: async () => config, loadStream: async () => faux.streamSimple });
    const unsubscribe = runtime.subscribe((event) => events.push(event));
    await runtime.openBook("book", new ArrayBuffer(1));
    await runtime.switchSession("session-1");

    // Edit the first message (index 0 = u1): leafId repoints to the root, the
    // new branch grows from there, and the streaming is aborted mid-flight.
    const promptPromise = runtime.prompt("edited again", {}, "prompt-abort", undefined, 0);
    await vi.waitFor(() => {
      if (!events.some((event) => event.type === "prompt_started")) throw new Error("prompt not started");
    }, { timeout: 2_000 });
    runtime.abort();
    await promptPromise;

    const aborted = events.find((event) => event.type === "prompt_aborted");
    expect(aborted).toBeTruthy();
    if (aborted?.type !== "prompt_aborted") return;
    // Payload equals the runtime's own projection of the persisted entries
    // (aborted assistant appended before emit — see prompt flow ordering).
    const finalSession = (runtime as unknown as { session: DecodedPiSession }).session;
    const { anchors, navigation } = sessionNavigation(finalSession);
    expect(aborted.messages).toEqual(visibleMessages(finalSession));
    expect(aborted.anchors).toEqual(anchors);
    expect(aborted.navigation).toEqual(navigation);
    // The edited fork root now has three sibling branches (u1, u1b, and the
    // new edit) and the payload reflects the newest one as active.
    const rootInfo = navigation["u1"];
    expect(rootInfo.options.map((option) => option.anchorId)).toEqual(["u1", "u1b", expect.any(String)]);
    expect(rootInfo.activeIndex).toBe(2);
    // One anchor per visible message.
    expect(aborted.anchors).toHaveLength(aborted.messages!.length);
    unsubscribe();
  });
});

describe("LiteraAgentRuntime.switchBranchAtAnchor", () => {
  it("switches to the previous/next sibling branch from a fork anchor", async () => {
    const current = forkedSession();
    // leafId is on the edited branch (u1b), so "u1b" is the active anchor.
    const { runtime, events, setLeafCalls, unsubscribe } = await harness(current, []);

    await runtime.switchBranchAtAnchor("session-1", "u1b", -1);

    expect(setLeafCalls).toEqual([{ sessionId: "session-1", leafId: "a1" }]);
    const switched = events.find((event) => event.type === "branch_switched");
    expect(switched?.type === "branch_switched" && switched.messages.map((message) => message.content))
      .toEqual(["first question", "first answer"]);

    // Switching forward again returns to the edited branch's deepest leaf.
    await runtime.switchBranchAtAnchor("session-1", "u1", 1);
    expect(setLeafCalls).toEqual([
      { sessionId: "session-1", leafId: "a1" },
      { sessionId: "session-1", leafId: "a1b" },
    ]);
    unsubscribe();
  });

  it("rejects out-of-range directions, unknown anchors, and inactive sessions", async () => {
    const current = forkedSession();
    const { runtime, setLeafCalls, unsubscribe } = await harness(current, []);

    // Active branch is index 1 (u1b): -2 would underflow.
    await expect(runtime.switchBranchAtAnchor("session-1", "u1b", -2 as -1)).rejects.toThrow();
    await expect(runtime.switchBranchAtAnchor("session-1", "ghost", -1)).rejects.toThrow("not in the session");
    await expect(runtime.switchBranchAtAnchor("other-session", "u1", -1)).rejects.toThrow("not active");
    expect(setLeafCalls).toHaveLength(0);
    unsubscribe();
  });
});
