import { describe, expect, it } from "vitest";
import type { AgentToolCall, AssistantBlock } from "@/types/agent";
import { isPartialCoverage, summarizeSources } from "./source-summary";

let nextId = 0;
function call(tool: string, result: unknown, extra: Partial<AgentToolCall> = {}): AssistantBlock {
  nextId += 1;
  return {
    type: "toolCall",
    toolCall: { toolCallId: `call-${nextId}`, tool, params: {}, result, done: true, ...extra },
  };
}
const read = (chapterIndex: number, part: number, totalParts: number, chapterTitle?: string) =>
  JSON.stringify({ chapterIndex, chapterNumber: chapterIndex + 1, chapterTitle, part, totalParts, text: "..." });

describe("summarizeSources", () => {
  it("returns null for answers without book tool calls", () => {
    expect(summarizeSources([{ type: "text", text: "hi" }])).toBeNull();
    expect(summarizeSources([call("draw_mindmap", "{}")])).toBeNull();
  });

  it("aggregates parts read per chapter and flags partial coverage", () => {
    const summary = summarizeSources([
      call("read_chapter", read(2, 0, 3, "第三章")),
      { type: "text", text: "..." },
      call("read_chapter", read(2, 1, 3, "第三章")),
      call("read_chapter", read(2, 1, 3, "第三章")),
      call("read_chapter", read(4, 0, 1, "第五章")),
    ])!;
    expect(summary.chapters).toEqual([
      { chapterIndex: 2, chapterNumber: 3, title: "第三章", partsRead: [0, 1], totalParts: 3 },
      { chapterIndex: 4, chapterNumber: 5, title: "第五章", partsRead: [0], totalParts: 1 },
    ]);
    expect(isPartialCoverage(summary.chapters[0])).toBe(true);
    expect(isPartialCoverage(summary.chapters[1])).toBe(false);
  });

  it("counts searches and hits", () => {
    const summary = summarizeSources([
      call("search_in_book", JSON.stringify([{ chapterIndex: 0 }, { chapterIndex: 1 }])),
      call("search_in_book", JSON.stringify([])),
    ])!;
    expect(summary.searches).toBe(2);
    expect(summary.hits).toBe(2);
  });

  it("reads live tool results as well as persisted text", () => {
    const live = { content: [{ type: "text", text: read(0, 0, 2) }], details: {} };
    const summary = summarizeSources([call("read_chapter", live)])!;
    expect(summary.chapters).toEqual([{ chapterIndex: 0, chapterNumber: 1, partsRead: [0], totalParts: 2 }]);
  });

  it("tracks lookups, failures and running calls, excluding mind maps", () => {
    const summary = summarizeSources([
      call("get_toc", "[]"),
      call("get_toc", "[]"),
      call("list_annotations", "{}"),
      call("read_chapter", "Chapter index is out of range", { isError: true }),
      call("search_in_book", undefined, { done: false }),
      call("draw_mindmap", "{}"),
    ])!;
    expect(summary.lookups).toEqual(["toc", "annotations"]);
    expect(summary.failed).toBe(1);
    expect(summary.running).toBe(true);
    expect(summary.calls.map((item) => item.tool)).toEqual([
      "get_toc",
      "get_toc",
      "list_annotations",
      "read_chapter",
      "search_in_book",
    ]);
  });
});
