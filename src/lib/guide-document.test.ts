import { describe, expect, it } from "vitest";
import {
  findRunIdForChapter,
  findRunIdForMessage,
  findRunIdForStep,
  findSideQuestionUserIndex,
  projectGuideDocument,
  resolveActiveGuideRun,
  searchGuideDocument,
} from "./guide-document";
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
    expect(doc.incompleteSteps).toEqual([]);
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

  it("projects aborted, errored, pre-tool streaming, and natural-language interrupted guide steps into incompleteSteps instead of sideThreads", () => {
    const step0 = makeStep(0, 0, 5, { title: "第一章" });
    const pickedStep1 = makeStep(1, 0, 5, { title: "第二章" });
    const branchInfo: AnchorBranchInfo = {
      activeIndex: 0,
      options: [
        { anchorId: "aborted-req", preview: "继续带读" },
        { anchorId: "retried-req", preview: "继续带读" },
      ],
    };

    const messages: AgentMessage[] = [
      // First step aborted before any committed step exists (orphan position).
      { role: "user", content: "开始带读：第一章", guideRequest: { step: step0 } },
      {
        role: "assistant",
        content: "刚讲了一半",
        stopReason: "aborted",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "tc-abort-0", tool: "guide_step", params: {}, done: true } },
          { type: "text", text: "刚讲了一半" },
        ],
      },
      // Committed step 0.
      { role: "user", content: "继续带读", guideRequest: {} },
      {
        role: "assistant",
        content: "第一章完整讲解",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "tc-ok-0", tool: "guide_step", params: {}, done: true, guide: step0 } },
          { type: "text", text: "第一章完整讲解" },
        ],
      },
      // Continue aborted after guide_step without persisted `guide`.
      { role: "user", content: "继续带读", guideRequest: {} },
      {
        role: "assistant",
        content: "第二章讲到一半停了",
        stopReason: "aborted",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "tc-abort-1", tool: "guide_step", params: {}, done: true } },
          { type: "text", text: "第二章讲到一半停了" },
        ],
      },
      // Picked step errored before calling guide_step.
      { role: "user", content: "带读：第二章", guideRequest: { step: pickedStep1 } },
      {
        role: "assistant",
        content: "",
        stopReason: "error",
        errorMessage: "网络超时",
        blocks: [],
      },
      // Natural-language guide request aborted after guide_step ran.
      { role: "user", content: "带读第三章" },
      {
        role: "assistant",
        content: "第三章开头……",
        stopReason: "aborted",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "tc-nl-abort", tool: "guide_step", params: { chapterIndex: 2 }, done: true } },
          { type: "text", text: "第三章开头……" },
        ],
      },
      // Pre-tool streaming thinking for a new guideRequest must not flash as a side question.
      { role: "user", content: "继续带读", guideRequest: {} },
      {
        role: "assistant",
        content: "",
        blocks: [{ type: "thinking", text: "先看看目录位置……" }],
      },
    ];

    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "s1",
      messages,
      branchAnchors: ["", "", "", "", "aborted-req", "", "", "", "", "", "", ""],
      branchNavigation: { "aborted-req": branchInfo },
      isStreaming: true,
    });

    expect(doc.steps).toHaveLength(1);
    expect(doc.orphanSideThreads).toEqual([]);
    expect(doc.steps[0].sideThreads).toEqual([]);
    expect(doc.totalQuestions).toBe(0);
    expect(doc.incompleteSteps).toHaveLength(5);

    expect(doc.incompleteSteps[0]).toMatchObject({
      afterStepIndex: null,
      requestMessageIndex: 0,
      assistantMessageIndex: 1,
      isGuideRequest: true,
      status: "aborted",
      content: "刚讲了一半",
      stopReason: "aborted",
    });
    expect(doc.incompleteSteps[1]).toMatchObject({
      afterStepIndex: 0,
      requestMessageIndex: 4,
      assistantMessageIndex: 5,
      label: "继续带读",
      isGuideRequest: true,
      status: "aborted",
      content: "第二章讲到一半停了",
      branchAnchorId: "aborted-req",
      branchInfo,
    });
    expect(doc.incompleteSteps[2]).toMatchObject({
      afterStepIndex: 0,
      requestMessageIndex: 6,
      assistantMessageIndex: 7,
      isGuideRequest: true,
      status: "error",
      errorMessage: "网络超时",
    });
    expect(doc.incompleteSteps[3]).toMatchObject({
      afterStepIndex: 0,
      requestMessageIndex: 8,
      assistantMessageIndex: 9,
      label: "带读第三章",
      isGuideRequest: false,
      status: "aborted",
      content: "第三章开头……",
    });
    expect(doc.incompleteSteps[4]).toMatchObject({
      afterStepIndex: 0,
      requestMessageIndex: 10,
      assistantMessageIndex: 11,
      label: "继续带读",
      isGuideRequest: true,
      status: "streaming",
      streaming: true,
    });

    // extractGuideStepCards never exposes interrupted guide steps as sideQuestions.
    expect(extractGuideStepCards(messages)[0].sideQuestions).toEqual([]);
  });
});

describe("guide-document chapter-scoped helpers", () => {
  const stepCh0: GuideStep = makeStep(0, 0, 4, { title: "第一章 起源" });
  const stepCh1: GuideStep = makeStep(1, 0, 5, { title: "第二章 演进" });

  function makeMultiRunDoc() {
    const messages: AgentMessage[] = [
      { role: "user", content: "开篇前的问题" },
      { role: "assistant", content: "开篇前的回答" },
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "第一章讲述自然选择的早期假说。",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: stepCh0 } },
          { type: "text", text: "第一章讲述自然选择的早期假说。" },
        ],
      },
      { role: "user", content: "这里的假说如何验证？" },
      { role: "assistant", content: "通过化石记录验证。" },
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "第二章进入分子生物学阶段。",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: stepCh1 } },
          { type: "text", text: "第二章进入分子生物学阶段。" },
        ],
      },
      { role: "user", content: "重读第一章", guideRequest: { step: stepCh0 } },
      {
        role: "assistant",
        content: "重读第一章补充了新的视角。",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t3", tool: "guide_step", params: {}, done: true, guide: stepCh0 } },
          { type: "text", text: "重读第一章补充了新的视角。" },
        ],
      },
    ];
    return projectGuideDocument({ bookId: "b1", sessionId: "s1", messages });
  }

  it("resolves active run, falls back to latest on stale id, and flags history viewing", () => {
    const doc = makeMultiRunDoc();
    expect(doc.runs).toHaveLength(3);
    expect(doc.runs[2].isReread).toBe(true);

    const latest = resolveActiveGuideRun(doc, null);
    expect(latest.activeRun?.id).toBe(doc.runs[2].id);
    expect(latest.activeRunIndex).toBe(2);
    expect(latest.isViewingHistory).toBe(false);

    const history = resolveActiveGuideRun(doc, doc.runs[0].id);
    expect(history.activeRun?.id).toBe(doc.runs[0].id);
    expect(history.isViewingHistory).toBe(true);

    const fallback = resolveActiveGuideRun(doc, "missing-run-id");
    expect(fallback.activeRun?.id).toBe(doc.runs[2].id);
    expect(fallback.isViewingHistory).toBe(false);
  });

  it("maps chapters, steps, orphan questions, and side questions to owning runs", () => {
    const doc = makeMultiRunDoc();

    expect(findRunIdForChapter(doc, 0)).toBe(doc.runs[2].id);
    expect(findRunIdForChapter(doc, 1)).toBe(doc.runs[1].id);
    expect(findRunIdForChapter(doc, 9)).toBeNull();

    expect(findRunIdForStep(doc, 0)).toBe(doc.runs[0].id);
    expect(findRunIdForStep(doc, 1)).toBe(doc.runs[1].id);
    expect(findRunIdForStep(doc, 2)).toBe(doc.runs[2].id);

    expect(findRunIdForMessage(doc, 0)).toBe(doc.runs[0].id);
    expect(findRunIdForMessage(doc, 1)).toBe(doc.runs[0].id);
    expect(findSideQuestionUserIndex(doc, 1)).toBe(0);

    expect(findRunIdForMessage(doc, 4)).toBe(doc.runs[0].id);
    expect(findRunIdForMessage(doc, 5)).toBe(doc.runs[0].id);
    expect(findSideQuestionUserIndex(doc, 5)).toBe(4);

    expect(findRunIdForMessage(doc, 7)).toBe(doc.runs[1].id);
    expect(findSideQuestionUserIndex(doc, 7)).toBeNull();
  });

  it("searches across all steps and side questions with context snippets", () => {
    const doc = makeMultiRunDoc();

    const hits = searchGuideDocument(doc, "化石记录");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "question",
      runId: doc.runs[0].id,
      messageIndex: 4,
      chapterTitle: "第一章 起源",
    });
    expect(hits[0].snippet).toContain("化石记录");

    const stepHits = searchGuideDocument(doc, "分子生物学");
    expect(stepHits).toHaveLength(1);
    expect(stepHits[0]).toMatchObject({
      kind: "step",
      runId: doc.runs[1].id,
      messageIndex: 7,
    });
  });
});
