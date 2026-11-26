import { describe, expect, it } from "vitest";
import { projectGuideDocument } from "./guide-document";
import { extractGuideStepCards } from "./guide-step-cards";
import type { AgentMessage, AnchorBranchInfo, GuideStep, LegacyGuideStep } from "@/types/agent";

function makeStep(
  chapterIndex: number,
  fromBlock: number,
  toBlock: number,
  options?: { title?: string; toChapterIndex?: number },
): GuideStep {
  return {
    from: {
      chapterIndex,
      chapterTitle: options?.title ?? `Chapter ${chapterIndex + 1}`,
      block: fromBlock,
      paragraph: fromBlock + 1,
    },
    to: {
      chapterIndex: options?.toChapterIndex ?? chapterIndex,
      chapterTitle: options?.title ?? `Chapter ${(options?.toChapterIndex ?? chapterIndex) + 1}`,
      block: toBlock,
      paragraph: toBlock + 1,
    },
  };
}

describe("projectGuideDocument", () => {
  it("projects an empty session cleanly", () => {
    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "s1",
      messages: [],
    });
    expect(doc.hasStarted).toBe(false);
    expect(doc.steps).toEqual([]);
    expect(doc.runs).toEqual([]);
    expect(doc.orphanSideThreads).toEqual([]);
    expect(doc.totalQuestions).toBe(0);
  });

  it("projects modern guide_step tool calls, hides mechanical guideRequest, and attaches side questions", () => {
    const step0 = makeStep(0, 0, 5, { title: "导言" });
    const step1 = makeStep(0, 6, 12, { title: "导言" });
    const step2 = makeStep(1, 0, 10, { title: "第一章" });
    const messages: AgentMessage[] = [
      { role: "user", content: "继续带读", guideRequest: {} },
      {
        role: "assistant",
        content: "这是导言前半部分的讲解。",
        blocks: [
          {
            type: "toolCall",
            toolCall: { toolCallId: "tc-1", tool: "guide_step", params: {}, done: true, guide: step0 },
          },
          { type: "text", text: "这是导言前半部分的讲解。" },
        ],
      },
      { role: "user", content: "这里的概念怎么理解？", selection: "核心概念" },
      { role: "assistant", content: "这个概念指的是……" },
      { role: "user", content: "继续带读", guideRequest: {} },
      {
        role: "assistant",
        content: "这是导言后半部分。",
        blocks: [
          {
            type: "toolCall",
            toolCall: { toolCallId: "tc-2", tool: "guide_step", params: {}, done: true, guide: step1 },
          },
          { type: "text", text: "这是导言后半部分。" },
        ],
      },
      { role: "guide_cut", reason: "manual" },
      { role: "user", content: "带读第一章" },
      {
        role: "assistant",
        content: "第一章概览。",
        blocks: [
          {
            type: "toolCall",
            toolCall: { toolCallId: "tc-3", tool: "guide_step", params: {}, done: true, guide: step2 },
          },
          { type: "text", text: "第一章概览。" },
        ],
      },
    ];
    const branchInfo: AnchorBranchInfo = {
      activeIndex: 1,
      options: [
        { anchorId: "a1", preview: "v1" },
        { anchorId: "a2", preview: "v2" },
      ],
    };

    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "s1",
      messages,
      branchAnchors: ["req0", "", "q0", "", "req1", "", "", "req2", ""],
      branchNavigation: { q0: branchInfo },
    });

    expect(doc.hasStarted).toBe(true);
    expect(doc.steps).toHaveLength(3);
    expect(doc.steps[0]).toMatchObject({
      stepIndex: 0,
      chapterIndex: 0,
      chapterTitle: "导言",
      messageIndex: 1,
      requestMessageIndex: 0,
      requestText: undefined,
      explanation: "这是导言前半部分的讲解。",
    });
    expect(doc.steps[0].sideThreads).toHaveLength(1);
    expect(doc.steps[0].sideThreads[0]).toMatchObject({
      userMessageIndex: 2,
      assistantMessageIndex: 3,
      question: "这里的概念怎么理解？",
      selection: "核心概念",
      answer: "这个概念指的是……",
      branchAnchorId: "q0",
      branchInfo,
    });
    // Natural-language step request ("带读第一章") becomes step2's requestText, not an orphan side question.
    expect(doc.steps[2].requestText).toBe("带读第一章");
    expect(doc.totalQuestions).toBe(1);

    // Runs group consecutive steps of chapter 0 together, followed by chapter 1.
    expect(doc.runs).toHaveLength(2);
    expect(doc.runs[0].chapterIndex).toBe(0);
    expect(doc.runs[0].steps.map((s) => s.stepIndex)).toEqual([0, 1]);
    expect(doc.runs[0].isReread).toBe(false);
    expect(doc.runs[1].chapterIndex).toBe(1);
    expect(doc.runs[1].steps.map((s) => s.stepIndex)).toEqual([2]);

    // Manual guide_cut marker lands right after step 1.
    expect(doc.markers).toHaveLength(1);
    expect(doc.markers[0]).toMatchObject({ kind: "guide_cut", messageIndex: 6, afterStepIndex: 1 });

    // extractGuideStepCards agrees on indices and side questions.
    const cards = extractGuideStepCards(messages);
    expect(cards.map((c) => c.stepIndex)).toEqual([0, 1, 2]);
    expect(cards[0].sideQuestions).toEqual([{ question: "这里的概念怎么理解？", answer: "这个概念指的是……" }]);
  });

  it("marks re-read chapter runs and preserves pre-first-step questions as orphanSideThreads", () => {
    const ch0 = makeStep(0, 0, 5, { title: "第一章" });
    const ch1 = makeStep(1, 0, 5, { title: "第二章" });
    const ch0Again = makeStep(0, 0, 5, { title: "第一章" });
    const messages: AgentMessage[] = [
      { role: "user", content: "这本书的作者是谁？" },
      { role: "assistant", content: "作者是某学者。" },
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "第一章讲解",
        blocks: [{ type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: ch0 } }],
      },
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "第二章讲解",
        blocks: [{ type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: ch1 } }],
      },
      { role: "user", content: "重读第一章", guideRequest: { step: ch0Again } },
      {
        role: "assistant",
        content: "第一章重讲",
        blocks: [{ type: "toolCall", toolCall: { toolCallId: "t3", tool: "guide_step", params: {}, done: true, guide: ch0Again } }],
      },
    ];

    const doc = projectGuideDocument({ bookId: "b1", sessionId: "s1", messages });
    expect(doc.orphanSideThreads).toHaveLength(1);
    expect(doc.orphanSideThreads[0].question).toBe("这本书的作者是谁？");
    expect(doc.runs).toHaveLength(3);
    expect(doc.runs[0].isReread).toBe(false);
    expect(doc.runs[1].isReread).toBe(false);
    expect(doc.runs[2]).toMatchObject({ chapterIndex: 0, isReread: true });
  });

  it("supports legacy message.guide steps, LegacyGuideStep, and in-flight streaming placeholders", () => {
    const legacy: LegacyGuideStep = { chapterIndex: 0, chapterTitle: "序言", part: 0, totalParts: 2 };
    const messages: AgentMessage[] = [
      { role: "user", content: "序言（第 1/2 部分）", guide: legacy },
      { role: "assistant", content: "旧版带读讲解" },
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "",
        blocks: [{ type: "toolCall", toolCall: { toolCallId: "pending-1", tool: "guide_step", params: {}, done: false } }],
      },
    ];

    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "s1",
      messages,
      isStreaming: true,
    });
    expect(doc.steps).toHaveLength(1);
    expect(doc.steps[0]).toMatchObject({
      stepIndex: 0,
      chapterIndex: 0,
      chapterTitle: "序言",
      explanation: "旧版带读讲解",
      messageIndex: 0,
    });
    expect(doc.pendingSteps).toEqual([
      { id: "pending-3-pending-1", messageIndex: 3, requestMessageIndex: 2, toolCallId: "pending-1" },
    ]);
  });

  it("projects TOC chapter progress statuses cleanly", () => {
    const step0 = makeStep(0, 0, 5, { title: "Ch 1" });
    const messages: AgentMessage[] = [
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "Explanation",
        blocks: [{ type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } }],
      },
    ];
    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "s1",
      messages,
      toc: [
        { chapterIndex: 0, label: "Ch 1", href: "ch1.xhtml" },
        { chapterIndex: 1, label: "Ch 2", href: "ch2.xhtml" },
      ],
      tocProgress: {
        "ch1.xhtml": { coveredBlocks: 6, totalBlocks: 10, current: true },
      },
    });
    expect(doc.chapters).toEqual([
      {
        chapterIndex: 0,
        title: "Ch 1",
        href: "ch1.xhtml",
        status: "in_progress",
        coveredBlocks: 6,
        totalBlocks: 10,
        isCurrent: true,
        stepIndices: [0],
        questionCount: 0,
      },
      {
        chapterIndex: 1,
        title: "Ch 2",
        href: "ch2.xhtml",
        status: "unread",
        coveredBlocks: 0,
        totalBlocks: 1,
        isCurrent: false,
        stepIndices: [],
        questionCount: 0,
      },
    ]);
  });
});
