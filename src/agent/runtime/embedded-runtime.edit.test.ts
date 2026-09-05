import { describe, expect, it, vi } from "vitest";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, type RuntimeConfig } from "./embedded-runtime";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";
import type { AgentEvent } from "@/types/agent";

const now = "2026-08-14T00:00:00Z";
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistantBase = { api: "openai-completions" as const, provider: "custom-a", model: "model-a", usage, stopReason: "stop" };

/**
 * Multi-turn session with one tool-call round between the two questions:
 *
 *   user0001 "first question"
 *   a1       assistant (toolCall search_in_book)
 *   r1       toolResult
 *   a2       assistant "looked up"            <- merged with a1 into ONE UI bubble
 *   user0002 "second question"
 *   a3       assistant "second answer"
 *
 * UI visible bubbles (visibleMessages indices):
 *   0: user   "first question"
 *   1: assistant (merged a1 + toolCall + a2)
 *   2: user   "second question"
 *   3: assistant "second answer"
 */
function toolTurnSession(): DecodedPiSession {
  return {
    header: { type: "session", version: 3, id: "session-1", timestamp: now, cwd: "" },
    entries: [
      { type: "message", id: "user0001", parentId: null, timestamp: now, message: { role: "user", content: "first question", timestamp: 1 } },
      { type: "message", id: "a1", parentId: "user0001", timestamp: now, message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "search_in_book", arguments: { queries: ["x"] } }], ...assistantBase, timestamp: 2 } },
      { type: "message", id: "r1", parentId: "a1", timestamp: now, message: { role: "toolResult", toolCallId: "call-1", toolName: "search_in_book", content: [{ type: "text", text: "[]" }], isError: false, timestamp: 3 } },
      { type: "message", id: "a2", parentId: "r1", timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "looked up" }], ...assistantBase, timestamp: 4 } },
      { type: "message", id: "user0002", parentId: "a2", timestamp: now, message: { role: "user", content: "second question", timestamp: 5 } },
      { type: "message", id: "a3", parentId: "user0002", timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "second answer" }], ...assistantBase, timestamp: 6 } },
    ],
    leafId: "a3",
  };
}

interface Harness {
  runtime: LiteraAgentRuntime;
  events: AgentEvent[];
  appends: Array<{ expected: string | null; entries: PiSessionEntry[] }>;
  current: DecodedPiSession;
  unsubscribe: () => void;
}

async function harness(session: DecodedPiSession, responses: string[]): Promise<Harness> {
  const events: AgentEvent[] = [];
  const appends: Array<{ expected: string | null; entries: PiSessionEntry[] }> = [];
  const sessions: SessionPort = {
    create: async () => session,
    list: async () => [],
    load: async () => session,
    delete: async () => {},
    append: async (_book, _session, expected, entries) => { appends.push({ expected, entries }); return entries.at(-1)?.id ?? null; },
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
  const runtime = new LiteraAgentRuntime({ sessions, book, loadConfig: async () => config, loadStream: async () => faux.streamSimple });
  const unsubscribe = runtime.subscribe((event) => events.push(event));
  await runtime.openBook("book", new ArrayBuffer(1));
  await runtime.switchSession("session-1");
  return { runtime, events, appends, current: session, unsubscribe };
}

describe("LiteraAgentRuntime edit flow", () => {
  it("scenario A: editing the second question (UI index 2) after a tool round rewinds past the tool round and completes the prompt", async () => {
    const current = toolTurnSession();
    const { runtime, events, appends, unsubscribe } = await harness(current, ["new answer"]);

    // UI index 2 = "second question": before the fix, the runtime resolved raw
    // entry index 2 to the toolResult-hidden assistant entry a2 and either threw
    // or rewound to the wrong point.
    await runtime.prompt("edited second question", {}, "prompt-1", undefined, 2);

    const rewound = events.find((event) => event.type === "session_rewound");
    expect(rewound).toBeTruthy();
    if (rewound?.type === "session_rewound") {
      // Everything before the edited message: the first question plus the merged
      // assistant bubble (toolCall card + final text), but NOT the second question.
      expect(rewound.messages).toEqual([
        { role: "user", content: "first question" },
        expect.objectContaining({ role: "assistant", content: "looked up" }),
      ]);
    }
    // The rewind point is user0002's parent (a2), i.e. the whole tool round stays.
    expect(appends[0].expected).toBe("a3");
    const firstBatch = appends[0].entries;
    expect(firstBatch[0].parentId).toBe("a2");
    const persistedUser = firstBatch.find((entry) => entry.type === "message" && (entry.message as { role?: string }).role === "user");
    expect(persistedUser?.message).toMatchObject({ role: "user", content: "edited second question" });
    expect(events.some((event) => event.type === "prompt_end")).toBe(true);
    unsubscribe();
  });

  it("scenario B: editing the first question (UI index 0) rewinds to the branch root", async () => {
    const current = toolTurnSession();
    const { runtime, events, appends, unsubscribe } = await harness(current, ["new answer"]);

    await runtime.prompt("edited first question", {}, "prompt-2", undefined, 0);

    const rewound = events.find((event) => event.type === "session_rewound");
    expect(rewound).toBeTruthy();
    if (rewound?.type === "session_rewound") {
      // Nothing before the first message: the rewound list is empty.
      expect(rewound.messages).toEqual([]);
    }
    // New branch grows from the root.
    expect(appends[0].expected).toBe("a3");
    expect(appends[0].entries[0].parentId).toBeNull();
    expect(events.some((event) => event.type === "prompt_end")).toBe(true);
    unsubscribe();
  });

  it("scenario C: an edit index pointing at an assistant bubble throws the local validation error, not a model failure", async () => {
    const current = toolTurnSession();
    const { runtime, events, unsubscribe } = await harness(current, []);

    // UI index 1 is the merged assistant bubble.
    await expect(runtime.prompt("bad target", {}, "prompt-3", undefined, 1)).rejects.toThrow("Edited message is not a visible user message");
    // The error event must carry the local message — not classifyPromptError's
    // "模型请求失败，请检查配置后重试".
    const error = events.find((event) => event.type === "error");
    expect(error?.type === "error" && error.message).toBe("Edited message is not a visible user message");
    expect(events.some((event) => event.type === "prompt_end")).toBe(false);
    unsubscribe();
  });

  it("an out-of-range edit index throws the same local validation error", async () => {
    const current = toolTurnSession();
    const { runtime, unsubscribe } = await harness(current, []);
    await expect(runtime.prompt("out of range", {}, "prompt-4", undefined, 99)).rejects.toThrow("Edited message is not a visible user message");
    unsubscribe();
  });
});
