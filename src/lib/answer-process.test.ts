import { describe, expect, it } from "vitest";
import type { AgentToolCall, AssistantBlock } from "@/types/agent";
import {
  annotationCount,
  layoutAnswer,
  liveActivity,
  passageAnchor,
  plainExcerpt,
  readResult,
  readStepChapterIndex,
  searchHits,
} from "./answer-process";

let nextId = 0;
function toolCall(tool: string, params: unknown, result?: unknown, extra: Partial<AgentToolCall> = {}): AgentToolCall {
  nextId += 1;
  return { toolCallId: `call-${nextId}`, tool, params, result, done: true, ...extra };
}
const block = (call: AgentToolCall): AssistantBlock => ({ type: "toolCall", toolCall: call });
const read = (chapterIndex: number, part: number) =>
  toolCall("read_chapter", { chapterIndex, part }, JSON.stringify({ chapterIndex, chapterNumber: chapterIndex + 1, part, totalParts: 3, text: "正文" }));

describe("layoutAnswer", () => {
  it("puts thinking, book tool calls and narration in the process and the rest in the answer", () => {
    const blocks: AssistantBlock[] = [
      { type: "thinking", text: "先想" },
      { type: "text", text: "我先看一下目录" },
      block(toolCall("get_toc", {}, "[]")),
      { type: "thinking", text: "再想" },
      block(read(2, 0)),
      { type: "thinking", text: "想好了" },
      { type: "text", text: "结论" },
    ];
    const { process, answer } = layoutAnswer(blocks);
    expect(process.map((step) => step.kind)).toEqual(["thinking", "narration", "tool", "thinking", "read", "thinking"]);
    expect(answer).toEqual([{ index: 6, block: blocks[6] }]);
  });

  it("keeps mind maps in the answer wherever they sit", () => {
    const mindmap = toolCall("draw_mindmap", { title: "图", outline: "# 图" }, "{}");
    const blocks: AssistantBlock[] = [block(mindmap), block(read(0, 0)), { type: "text", text: "说明" }];
    const { process, answer } = layoutAnswer(blocks);
    expect(process.map((step) => step.kind)).toEqual(["read"]);
    expect(answer.map((entry) => entry.index)).toEqual([0, 2]);
  });

  it("treats every text block as answer when there are no book tool calls", () => {
    const blocks: AssistantBlock[] = [
      { type: "thinking", text: "想" },
      { type: "text", text: "一" },
      { type: "text", text: "二" },
    ];
    const { process, answer } = layoutAnswer(blocks);
    expect(process.map((step) => step.kind)).toEqual(["thinking"]);
    expect(answer.map((entry) => entry.index)).toEqual([1, 2]);
  });

  it("merges consecutive reads of one chapter into one step", () => {
    const { process } = layoutAnswer([
      block(read(2, 0)),
      block(read(2, 1)),
      block(read(3, 0)),
      { type: "thinking", text: "想" },
      block(read(3, 1)),
    ]);
    expect(process.map((step) => (step.kind === "read" ? step.calls.length : step.kind))).toEqual([2, 1, "thinking", 1]);
  });

  it("groups running reads by their requested chapter", () => {
    const running = toolCall("read_chapter", { chapterIndex: 2, part: 1 }, undefined, { done: false });
    const { process } = layoutAnswer([block(read(2, 0)), block(running)]);
    expect(process).toHaveLength(1);
    expect(readStepChapterIndex(running)).toBe(2);
  });

  it("drops empty thinking and narration", () => {
    const { process } = layoutAnswer([
      { type: "thinking", text: "" },
      { type: "text", text: "  " },
      block(read(0, 0)),
    ]);
    expect(process.map((step) => step.kind)).toEqual(["read"]);
  });
});

describe("liveActivity", () => {
  it("is null when not streaming or while the answer is being written", () => {
    expect(liveActivity([{ type: "thinking", text: "想" }], false)).toBeNull();
    expect(liveActivity([block(read(0, 0)), { type: "text", text: "答" }], true)).toBeNull();
  });

  it("reports the running book tool call", () => {
    const running = toolCall("search_in_book", { queries: ["自由"] }, undefined, { done: false });
    expect(liveActivity([{ type: "thinking", text: "想" }, block(running)], true)).toEqual({ kind: "tool", call: running });
  });

  it("reports thinking while the model thinks or digests a tool result", () => {
    expect(liveActivity([{ type: "thinking", text: "想" }], true)).toEqual({ kind: "thinking" });
    expect(liveActivity([block(read(0, 0))], true)).toEqual({ kind: "thinking" });
  });

  it("is null before anything has streamed or while a mind map is drawn", () => {
    expect(liveActivity([], true)).toBeNull();
    const mindmap = toolCall("draw_mindmap", {}, undefined, { done: false });
    expect(liveActivity([block(mindmap)], true)).toBeNull();
  });
});

describe("tool result readers", () => {
  it("reads read_chapter results, live or persisted", () => {
    const text = JSON.stringify({ chapterIndex: 1, chapterNumber: 2, chapterTitle: "二", part: 0, totalParts: 2, text: "正文" });
    expect(readResult(toolCall("read_chapter", {}, text))).toEqual({
      chapterIndex: 1,
      chapterNumber: 2,
      title: "二",
      part: 0,
      totalParts: 2,
      text: "正文",
    });
    expect(readResult(toolCall("read_chapter", {}, { content: [{ type: "text", text }] }))?.chapterIndex).toBe(1);
    expect(readResult(toolCall("read_chapter", {}, "Chapter index is out of range", { isError: true }))).toBeUndefined();
  });

  it("reads search hits and annotation counts", () => {
    const hits = [{ chapterIndex: 0, part: 0, match: "exact", snippet: "…自由…" }];
    expect(searchHits(toolCall("search_in_book", {}, JSON.stringify(hits)))).toEqual(hits);
    expect(searchHits(toolCall("search_in_book", {}, "oops"))).toBeUndefined();
    expect(annotationCount(toolCall("list_annotations", {}, JSON.stringify({ bookmarks: [{}], highlights: [{}, {}] })))).toBe(3);
  });
});

describe("plainExcerpt", () => {
  it("drops Markdown markers and truncates", () => {
    expect(plainExcerpt("# 标题\n\n> 引文 **加粗**\n\n- 条目", 100)).toBe("标题\n引文 加粗\n条目");
    expect(plainExcerpt("一二三四五六", 3)).toBe("一二三…");
  });
});

describe("passageAnchor", () => {
  it("takes the start of the first substantial line, without Markdown or ellipses", () => {
    expect(passageAnchor("# 第三章\n\n**他说**：自由不是没有约束，而是选择承担哪些约束。", 12)).toBe("他说：自由不是没有约束，");
    expect(passageAnchor("…前文的结尾。\n真正被搜索到的那一段文字很长很长…", 40)).toBe("真正被搜索到的那一段文字很长很长");
  });

  it("returns undefined when nothing is long enough to locate", () => {
    expect(passageAnchor("# 一")).toBeUndefined();
  });
});
