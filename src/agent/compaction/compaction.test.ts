import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { PiSessionEntry } from "@/agent/sessions/pi-session";
import {
  calculateContextTokens,
  contextBudget,
  estimateBranchTokens,
  estimateContextTokens,
  estimateTokens,
  findCutPoint,
  prepareCompaction,
  preparePrune,
  serializeConversation,
} from "./compaction";
import { imageRefText } from "@/agent/sessions/image-refs";

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

function custom(id: string, parentId: string | null, text: string, customType = "bookSnapshot"): PiSessionEntry {
  return entry(id, parentId, "custom_message", { customType, content: text, display: false });
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

  it("counts an Image reference as the image it is re-sent as", () => {
    const image = estimateTokens({ role: "toolResult", toolCallId: "t", toolName: "view_image", content: [{ type: "image", data: "", mimeType: "image/png" }], isError: false, timestamp: 1 } as AgentMessage);
    expect(estimateTokens({ role: "toolResult", toolCallId: "t", toolName: "view_image", content: [{ type: "text", text: imageRefText("OPS/a.png") }], isError: false, timestamp: 1 } as AgentMessage)).toBe(image);
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

describe("contextBudget", () => {
  it.each([
    [32_000, { pruneAt: 16_000, compactAt: 27_200, keepRecent: 8_000, summaryMaxTokens: 3_200 }],
    [128_000, { pruneAt: 64_000, compactAt: 111_616, keepRecent: 32_000, summaryMaxTokens: 8_192 }],
    [200_000, { pruneAt: 100_000, compactAt: 183_616, keepRecent: 40_000, summaryMaxTokens: 8_192 }],
    [1_000_000, { pruneAt: 100_000, compactAt: 983_616, keepRecent: 40_000, summaryMaxTokens: 8_192 }],
  ])("scales thresholds to a %i-token window", (window, budget) => {
    expect(contextBudget(window)).toEqual(budget);
  });

  it("disables maintenance without a known window", () => {
    expect(contextBudget(0)).toBeUndefined();
  });

  it("prunes before it compacts", () => {
    for (const window of [8_000, 32_000, 128_000, 1_000_000]) {
      const budget = contextBudget(window)!;
      expect(budget.pruneAt).toBeLessThan(budget.compactAt);
      expect(budget.keepRecent).toBeLessThan(budget.compactAt);
    }
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

  it("keeps only the latest turn when it alone exceeds the budget", () => {
    const entries = [
      user("u1", null, "a"),
      assistant("a1", "u1", "b"),
      user("u2", "a1", "c"),
      assistant("a2", "u2", "d".repeat(8000)),
    ];
    expect(findCutPoint(entries, 0, entries.length, 1000)).toBe(2);
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
    expect(prepareCompaction(entries, 20_000)).toBeUndefined();
  });

  it("returns undefined when there is nothing to summarize", () => {
    const entries = [user("u1", null, "a")];
    expect(prepareCompaction(entries, 20_000)).toBeUndefined();
  });

  it("prepares messages to summarize and the first kept entry id", () => {
    const entries = [
      user("u1", null, "a".repeat(4000)),
      assistant("a1", "u1", "b".repeat(4000)),
      user("u2", "a1", "c".repeat(4000)),
      assistant("a2", "u2", "d".repeat(4000)),
    ];
    const preparation = prepareCompaction(entries, 2000);
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
    const preparation = prepareCompaction(entries, 2000);
    expect(preparation).toBeDefined();
    expect(preparation!.previousSummary).toBe("old summary");
    // Boundary starts at u1 (firstKeptEntryId of previous compaction); cut keeps u3
    expect(preparation!.firstKeptEntryId).toBe("u3");
    expect(preparation!.messagesToSummarize.map((message) => (message as { role: string }).role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

describe("serializeConversation", () => {
  it("formats reader, assistant, tool calls, search results, and reading context", () => {
    const messages = [
      { role: "custom", customType: "readingContext", content: "Current chapter: One", display: false, timestamp: 0 },
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi" }, { type: "toolCall", id: "t", name: "search_in_book", arguments: { queries: ["whale"] } }], timestamp: 2 },
      { role: "toolResult", toolCallId: "t", toolName: "search_in_book", content: [{ type: "text", text: "3 hits" }], isError: false, timestamp: 3 },
    ] as AgentMessage[];
    const text = serializeConversation(messages);
    expect(text).toContain("[Reading context]: Current chapter: One");
    expect(text).toContain("[Reader]: hello");
    expect(text).toContain("[Assistant]: hi");
    expect(text).toContain('[Assistant tool calls]: search_in_book(queries=["whale"])');
    expect(text).toContain("[Tool result search_in_book]: 3 hits");
  });

  it("drops thinking, Book text from read_chapter, the Book snapshot and chapter recaps", () => {
    const messages = [
      { role: "custom", customType: "bookSnapshot", content: "snapshot", display: false, timestamp: 0 },
      { role: "custom", customType: "guideRecap", content: "Chapter recap", display: true, timestamp: 1 },
      { role: "assistant", content: [{ type: "thinking", thinking: "pondering" }, { type: "toolCall", id: "t", name: "read_chapter", arguments: { chapterIndex: 0 } }], timestamp: 2 },
      { role: "toolResult", toolCallId: "t", toolName: "read_chapter", content: [{ type: "text", text: "chapter text" }], isError: false, timestamp: 3 },
    ] as AgentMessage[];
    const text = serializeConversation(messages);
    expect(text).toBe("[Assistant tool calls]: read_chapter(chapterIndex=0)");
  });

  it("truncates long tool results", () => {
    const messages = [
      { role: "toolResult", toolCallId: "t", toolName: "x", content: [{ type: "text", text: "a".repeat(5000) }], isError: false, timestamp: 1 },
    ] as AgentMessage[];
    const text = serializeConversation(messages);
    expect(text.length).toBeLessThan(1600);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("estimateTokens for CJK text", () => {
  it("counts each CJK character as a token", () => {
    expect(estimateTokens({ role: "user", content: "鲸鱼是哺乳动物", timestamp: 1 } as AgentMessage)).toBe(7);
    expect(estimateTokens({ role: "user", content: "鲸鱼 whale", timestamp: 1 } as AgentMessage)).toBe(4);
  });
});

describe("findCutPoint with reading context", () => {
  it("keeps a turn's reading context with its user message", () => {
    const entries = [
      user("u1", null, "a".repeat(4000)),
      assistant("a1", "u1", "b".repeat(4000)),
      custom("r2", "a1", "Current chapter: Two", "readingContext"),
      user("u2", "r2", "c".repeat(4000)),
      assistant("a2", "u2", "d".repeat(4000)),
    ];
    expect(findCutPoint(entries, 0, entries.length, 2000)).toBe(2);
  });
});

describe("preparePrune", () => {
  const budget = { pruneAt: 0, compactAt: 0, keepRecent: 2000, summaryMaxTokens: 0 };

  it("clears Book tool results older than the kept turns", () => {
    const entries = [
      user("u1", null, "q"),
      assistant("a1", "u1", "reading"),
      toolResult("t1", "a1", "x".repeat(8000)),
      assistant("a1b", "t1", "answer"),
      user("u2", "a1b", "c".repeat(4000)),
      assistant("a2", "u2", "d".repeat(4000)),
    ];
    const prune = preparePrune(entries, budget);
    expect(prune?.throughEntryId).toBe("a1b");
    expect(prune!.tokensSaved).toBeGreaterThan(1900);
  });

  it("clears viewed Book images like other Book tool results", () => {
    const viewed = entry("t1", "a1", "message", {
      message: { role: "toolResult", toolCallId: "t1", toolName: "view_image", content: [{ type: "text", text: imageRefText("OPS/a.png") }], isError: false, timestamp: 3 },
    });
    const entries = [
      user("u1", null, "q"),
      assistant("a1", "u1", "looking"),
      viewed,
      assistant("a1b", "t1", "answer"),
      user("u2", "a1b", "c".repeat(4000)),
      assistant("a2", "u2", "d".repeat(4000)),
    ];
    expect(preparePrune(entries, budget)?.throughEntryId).toBe("a1b");
  });

  it("does nothing when only kept turns hold tool results", () => {
    const entries = [
      user("u1", null, "q"),
      assistant("a1", "u1", "reading"),
      toolResult("t1", "a1", "x".repeat(8000)),
    ];
    expect(preparePrune(entries, budget)).toBeUndefined();
  });

  it("skips results that are already pruned and non-Book tools", () => {
    const pruned = { ...toolResult("t1", "a1", "placeholder"), pruned: true };
    const mindmap = entry("t2", "t1", "message", {
      message: { role: "toolResult", toolCallId: "t2", toolName: "draw_mindmap", content: [{ type: "text", text: "x".repeat(8000) }], isError: false, timestamp: 3 },
    });
    const entries = [
      user("u1", null, "q"),
      assistant("a1", "u1", "reading"),
      pruned,
      mindmap,
      user("u2", "t2", "c".repeat(8000)),
    ];
    expect(preparePrune(entries, budget)).toBeUndefined();
  });
});

describe("estimateBranchTokens", () => {
  const usage = (totalTokens: number) => ({ input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

  it("trusts the last usage when no maintenance came after it", () => {
    const entries = [user("u1", null, "q"), assistant("a1", "u1", "a", usage(50_000)), user("u2", "a1", "abcdefgh")];
    expect(estimateBranchTokens(entries, entries)).toBe(50_002);
  });

  it("estimates every message once maintenance came after the last usage", () => {
    const entries = [user("u1", null, "abcd"), assistant("a1", "u1", "abcd", usage(50_000)), entry("p1", "a1", "context_prune", { throughEntryId: "a1" })];
    expect(estimateBranchTokens(entries, entries)).toBe(2);
  });
});
