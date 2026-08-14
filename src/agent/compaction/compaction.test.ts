import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { PiSessionEntry } from "@/agent/sessions/pi-session";
import {
  DEFAULT_COMPACTION_SETTINGS,
  calculateContextTokens,
  estimateContextTokens,
  estimateTokens,
  findCutPoint,
  prepareCompaction,
  serializeConversation,
  shouldCompact,
} from "./compaction";

const now = "2026-08-15T00:00:00Z";

function entry(id: string, parentId: string | null, type: string, fields: Record<string, unknown> = {}): PiSessionEntry {
  return { type, id, parentId, timestamp: now, ...fields };
}

function user(id: string, parentId: string | null, text: string): PiSessionEntry {
  return entry(id, parentId, "message", { message: { role: "user", content: text, timestamp: 1 } });
}

function assistant(id: string, parentId: string | null, text: string, usage?: unknown): PiSessionEntry {
  return entry(id, parentId, "message", {
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 2,
    },
  });
}

function toolResult(id: string, parentId: string | null, text: string): PiSessionEntry {
  return entry(id, parentId, "message", {
    message: { role: "toolResult", toolCallId: "t1", toolName: "read_chapter", content: [{ type: "text", text }], isError: false, timestamp: 3 },
  });
}

function custom(id: string, parentId: string | null, text: string): PiSessionEntry {
  return entry(id, parentId, "custom_message", { customType: "bookSnapshot", content: text, display: false });
}

function compaction(id: string, parentId: string | null, summary: string, firstKeptEntryId: string): PiSessionEntry {
  return entry(id, parentId, "compaction", { summary, firstKeptEntryId, tokensBefore: 100 });
}

describe("estimateTokens", () => {
  it("estimates user text at chars/4", () => {
    expect(estimateTokens({ role: "user", content: "abcd", timestamp: 1 } as AgentMessage)).toBe(1);
    expect(estimateTokens({ role: "user", content: "abcdefgh", timestamp: 1 } as AgentMessage)).toBe(2);
  });

  it("counts assistant text, thinking, and tool call blocks", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "abcd" },
        { type: "thinking", thinking: "efgh" },
        { type: "toolCall", id: "t", name: "read_chapter", arguments: { chapterIndex: 1 } },
      ],
      timestamp: 1,
    } as AgentMessage;
    // text 4 + thinking 4 + name 12 + args ~20 → ~40 chars → 10 tokens
    expect(estimateTokens(message)).toBe(10);
  });

  it("counts tool result content", () => {
    expect(estimateTokens({ role: "toolResult", toolCallId: "t", toolName: "x", content: [{ type: "text", text: "abcdefgh" }], isError: false, timestamp: 1 } as AgentMessage)).toBe(2);
  });

  it("counts compaction summary length", () => {
    expect(estimateTokens({ role: "compactionSummary", summary: "abcdefgh", timestamp: 1 } as AgentMessage)).toBe(2);
  });
});

describe("calculateContextTokens", () => {
  it("prefers totalTokens when present", () => {
    expect(calculateContextTokens({ totalTokens: 500, input: 100, output: 50, cacheRead: 0, cacheWrite: 0 })).toBe(500);
  });

  it("falls back to component sum when totalTokens is zero", () => {
    expect(calculateContextTokens({ totalTokens: 0, input: 100, output: 50, cacheRead: 20, cacheWrite: 10 })).toBe(180);
  });
});

describe("estimateContextTokens", () => {
  it("uses the last valid assistant usage and estimates trailing messages", () => {
    const messages = [
      { role: "user", content: "q", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "a" }], usage: { totalTokens: 1000, input: 900, output: 100, cacheRead: 0, cacheWrite: 0 }, stopReason: "stop", timestamp: 2 },
      { role: "user", content: "abcdefgh", timestamp: 3 },
    ] as AgentMessage[];
    const estimate = estimateContextTokens(messages);
    expect(estimate.tokens).toBe(1000 + 2);
    expect(estimate.usageTokens).toBe(1000);
    expect(estimate.trailingTokens).toBe(2);
    expect(estimate.lastUsageIndex).toBe(1);
  });

  it("skips aborted and error assistant messages when looking for usage", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "a" }], usage: { totalTokens: 1000, input: 900, output: 100, cacheRead: 0, cacheWrite: 0 }, stopReason: "error", errorMessage: "boom", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "b" }], usage: { totalTokens: 2000, input: 1900, output: 100, cacheRead: 0, cacheWrite: 0 }, stopReason: "stop", timestamp: 2 },
    ] as AgentMessage[];
    expect(estimateContextTokens(messages).usageTokens).toBe(2000);
  });

  it("falls back to pure estimation when no valid usage exists", () => {
    const messages = [
      { role: "user", content: "abcdefgh", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "abcd" }], usage: { totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: "stop", timestamp: 2 },
    ] as AgentMessage[];
    const estimate = estimateContextTokens(messages);
    expect(estimate.lastUsageIndex).toBeNull();
    expect(estimate.tokens).toBe(2 + 1);
  });
});

describe("shouldCompact", () => {
  it("triggers when context exceeds window minus reserve", () => {
    expect(shouldCompact(120_000, 128_000, DEFAULT_COMPACTION_SETTINGS)).toBe(true);
    expect(shouldCompact(111_616, 128_000, DEFAULT_COMPACTION_SETTINGS)).toBe(false);
  });

  it("never triggers when disabled", () => {
    expect(shouldCompact(500_000, 128_000, { ...DEFAULT_COMPACTION_SETTINGS, enabled: false })).toBe(false);
  });
});

describe("findCutPoint", () => {
  it("cuts at the closest user message at or after the budget", () => {
    const entries = [
      user("u1", null, "a".repeat(4000)),      // 1000 tokens
      assistant("a1", "u1", "b".repeat(4000)), // 1000 tokens
      user("u2", "a1", "c".repeat(4000)),      // 1000 tokens
      assistant("a2", "u2", "d".repeat(4000)),  // 1000 tokens
      user("u3", "a2", "e".repeat(4000)),      // 1000 tokens
      assistant("a3", "u3", "f".repeat(4000)),  // 1000 tokens
    ];
    // keepRecentTokens=2000: walking back accumulates a3(1000)+u3(1000)=2000 → cut at u3
    expect(findCutPoint(entries, 0, entries.length, 2000)).toBe(4);
  });

  it("never cuts at a tool result", () => {
    const entries = [
      user("u1", null, "a".repeat(4000)),
      assistant("a1", "u1", "b".repeat(4000)),
      toolResult("t1", "a1", "c".repeat(4000)),
      user("u2", "t1", "d".repeat(4000)),
      assistant("a2", "u2", "e".repeat(4000)),
    ];
    // Budget 2000: walking back hits t1 (1000) then a1 (1000) → 2000, but t1 is not a cut point;
    // closest valid cut point at or after t1 is u2.
    expect(findCutPoint(entries, 0, entries.length, 2000)).toBe(3);
  });

  it("defaults to the first cut point when the budget is never reached", () => {
    const entries = [
      user("u1", null, "a"),
      assistant("a1", "u1", "b"),
      user("u2", "a1", "c"),
    ];
    expect(findCutPoint(entries, 0, entries.length, 2000)).toBe(0);
  });

  it("returns startIndex when no cut point exists in range", () => {
    const entries = [toolResult("t1", null, "x")];
    expect(findCutPoint(entries, 0, entries.length, 2000)).toBe(0);
  });
});

describe("prepareCompaction", () => {
  it("returns undefined when the last entry is already a compaction", () => {
    const entries = [
      user("u1", null, "a"),
      compaction("c1", "u1", "summary", "u1"),
    ];
    expect(prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS)).toBeUndefined();
  });

  it("returns undefined when there is nothing to summarize", () => {
    const entries = [user("u1", null, "a")];
    expect(prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS)).toBeUndefined();
  });

  it("prepares messages to summarize and the first kept entry id", () => {
    const entries = [
      user("u1", null, "a".repeat(4000)),
      assistant("a1", "u1", "b".repeat(4000)),
      user("u2", "a1", "c".repeat(4000)),
      assistant("a2", "u2", "d".repeat(4000)),
    ];
    const preparation = prepareCompaction(entries, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 2000 });
    expect(preparation).toBeDefined();
    expect(preparation!.firstKeptEntryId).toBe("u2");
    expect(preparation!.messagesToSummarize.map((message) => (message as { role: string }).role)).toEqual(["user", "assistant"]);
    expect(preparation!.previousSummary).toBeUndefined();
    expect(preparation!.tokensBefore).toBeGreaterThan(0);
  });

  it("resumes from the previous compaction boundary and carries its summary", () => {
    const entries = [
      user("u1", null, "a".repeat(4000)),
      assistant("a1", "u1", "b".repeat(4000)),
      compaction("c1", "a1", "old summary", "u1"),
      user("u2", "c1", "c".repeat(4000)),
      assistant("a2", "u2", "d".repeat(4000)),
      user("u3", "a2", "e".repeat(4000)),
      assistant("a3", "u3", "f".repeat(4000)),
    ];
    const preparation = prepareCompaction(entries, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 2000 });
    expect(preparation).toBeDefined();
    expect(preparation!.previousSummary).toBe("old summary");
    // Boundary starts at u1 (firstKeptEntryId of previous compaction); cut keeps u3
    expect(preparation!.firstKeptEntryId).toBe("u3");
    expect(preparation!.messagesToSummarize.map((message) => (message as { role: string }).role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

describe("serializeConversation", () => {
  it("formats user, assistant, tool result, and custom messages", () => {
    const messages = [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi" }, { type: "toolCall", id: "t", name: "read_chapter", arguments: { chapterIndex: 0 } }], timestamp: 2 },
      { role: "toolResult", toolCallId: "t", toolName: "read_chapter", content: [{ type: "text", text: "chapter text" }], isError: false, timestamp: 3 },
      { role: "custom", customType: "bookSnapshot", content: "snapshot", display: false, timestamp: 4 },
    ] as AgentMessage[];
    const text = serializeConversation(messages);
    expect(text).toContain("[User]: hello");
    expect(text).toContain("[Assistant]: hi");
    expect(text).toContain("[Assistant tool calls]: read_chapter(chapterIndex=0)");
    expect(text).toContain("[Tool result]: chapter text");
    expect(text).toContain("[Context]: snapshot");
  });

  it("truncates long tool results", () => {
    const messages = [
      { role: "toolResult", toolCallId: "t", toolName: "x", content: [{ type: "text", text: "a".repeat(5000) }], isError: false, timestamp: 1 },
    ] as AgentMessage[];
    const text = serializeConversation(messages);
    expect(text.length).toBeLessThan(2100);
    expect(text.endsWith("…")).toBe(true);
  });
});
