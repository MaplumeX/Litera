// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "@/lib/agent-reducer";
import type { GuideStep } from "@/types/agent";

const prompt = vi.fn();
const editPrompt = vi.fn();
const abort = vi.fn();
const switchSession = vi.fn();
const newSession = vi.fn();
const nextGuideStep = vi.fn();
const guideStepAfterChapter = vi.fn();
const guideStepAtHref = vi.fn();
const guideOutline = vi.fn();
const guideStepTo = vi.fn();
const guideStepToSelection = vi.fn();
const guideStepAnchor = vi.fn();
const guideStepImages = vi.fn();
const readStepImageUrl = vi.fn();
const guideContextStats = vi.fn();
const resetGuideContext = vi.fn();
const restartGuidedSession = vi.fn();
const switchBranchAtAnchor = vi.fn();
const updateSessionConfig = vi.fn();
const locateQuote = vi.fn();

let mockState: AgentState;

vi.mock("@/lib/use-guide-bridge", () => ({
  useGuideBridge: () => ({
    state: mockState,
    ensureCanonicalGuide: vi.fn(),
    switchSession,
    newGuidedSession: newSession,
    takeStep: prompt,
    askSideQuestion: prompt,
    editTurn: editPrompt,
    abort,
    switchBranchAtAnchor,
    restartGuide: restartGuidedSession,
    updateConfig: updateSessionConfig,
    resetContext: resetGuideContext,
    contextStats: guideContextStats,
    nextStep: nextGuideStep,
    stepAfterChapter: guideStepAfterChapter,
    stepAtHref: guideStepAtHref,
    outline: guideOutline,
    stepTo: guideStepTo,
    stepToSelection: guideStepToSelection,
    stepAnchor: guideStepAnchor,
    stepImages: guideStepImages,
    readStepImageUrl,
    locateQuote,
  }),
}));

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({
    snapshot: {
      configured: true,
      provider: "openai",
      model: "gpt-4o",
      thinkingLevel: "medium",
      customProviders: [],
    },
    load: vi.fn(),
    switchProvider: vi.fn(),
    setThinkingLevel: vi.fn(),
  }),
}));

import { GuideWorkspace, type GuideWorkspaceHandle } from "./GuideWorkspace";

const step0: GuideStep = {
  from: { chapterIndex: 0, chapterTitle: "第一章", block: 0, paragraph: 1 },
  to: { chapterIndex: 0, chapterTitle: "第一章", block: 4, paragraph: 5 },
};
const step1: GuideStep = {
  from: { chapterIndex: 1, chapterTitle: "第二章", block: 0, paragraph: 1 },
  to: { chapterIndex: 1, chapterTitle: "第二章", block: 5, paragraph: 6 },
};

function makeGuidedState(overrides?: Partial<AgentState>): AgentState {
  return {
    version: 1,
    status: "bookReady",
    activeBookId: "book-1",
    sessionId: "guided-1",
    promptId: null,
    messages: [],
    sessions: [
      { id: "guided-1", title: "带读", createdAt: "1", updatedAt: "2", kind: "guided" },
    ],
    error: null,
    compaction: null,
    sessionListRequestId: null,
    branchNavigation: {},
    branchAnchors: [],
    ...overrides,
  };
}

describe("GuideWorkspace", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    nextGuideStep.mockResolvedValue(step1);
    guideStepImages.mockResolvedValue([]);
    guideContextStats.mockReturnValue({ recapCount: 1, activeTokens: 2400, windowTarget: 35000 });
    mockState = makeGuidedState();
  });

  it("renders chapter-grouped step sections without mechanical guideRequest bubbles, and collapses older side threads", async () => {
    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第一章的核心论述。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章的核心论述。" },
          ],
        },
        { role: "user", content: "为什么作者这样定义？" },
        { role: "assistant", content: "因为作者基于历史脉络。" },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第二章的展开。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
            { type: "text", text: "第二章的展开。" },
          ],
        },
        { role: "user", content: "第二章和第一章怎么呼应？" },
        { role: "assistant", content: "通过核心假设承接。" },
      ],
    });

    render(<GuideWorkspace bookId="book-1" />);

    expect(screen.getAllByTestId("guide-chapter-group")).toHaveLength(2);
    expect(screen.getAllByTestId("guide-step-section")).toHaveLength(2);
    // Mechanical "继续带读" user bubbles must NOT appear in the document body.
    expect(screen.queryByText("继续带读")).toBeNull();
    expect(screen.getByText("第一章的核心论述。")).toBeTruthy();
    expect(screen.getByText("第二章的展开。")).toBeTruthy();

    // Older step's side thread is collapsed by default; latest step's side thread is expanded.
    expect(screen.queryByText("为什么作者这样定义？")).toBeNull();
    expect(screen.getByText("第二章和第一章怎么呼应？")).toBeTruthy();

    // Expanding older step's side thread reveals its Q&A.
    const toggles = screen.getAllByRole("button", { name: /追问/ });
    fireEvent.click(toggles[0]);
    expect(screen.getByText("为什么作者这样定义？")).toBeTruthy();
    expect(screen.getByText("因为作者基于历史脉络。")).toBeTruthy();
  });

  it("regenerates a step from its section header and supports extraStepActions slot", async () => {
    const onSaveNote = vi.fn();
    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "带读：第一章", guideRequest: { step: step0 } },
        {
          role: "assistant",
          content: "第一章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章讲解。" },
          ],
        },
      ],
    });

    render(
      <GuideWorkspace
        bookId="book-1"
        extraStepActions={() => [
          { id: "save", label: "存为笔记", icon: <span>S</span>, onClick: onSaveNote },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "存为笔记" }));
    expect(onSaveNote).toHaveBeenCalledTimes(1);
    expect(onSaveNote.mock.calls[0][0].stepIndex).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "重新讲解" }));
    await waitFor(() => expect(editPrompt).toHaveBeenCalledTimes(1));
    expect(editPrompt.mock.calls[0][0]).toBe(0);
  });

  it("supports imperative guideChapter and exposes scrollToStep", async () => {
    guideStepAtHref.mockResolvedValue(step1);
    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "带读：第一章", guideRequest: { step: step0 } },
        {
          role: "assistant",
          content: "第一章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
          ],
        },
      ],
    });
    const ref = createRef<GuideWorkspaceHandle>();
    render(<GuideWorkspace ref={ref} bookId="book-1" />);

    await act(async () => {
      ref.current?.guideChapter("ch2.xhtml");
    });
    await waitFor(() => expect(guideStepAtHref).toHaveBeenCalledWith("ch2.xhtml"));
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("renders an aborted guided step as an incomplete step card (not a follow-up question) and retries from its request", async () => {
    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第一章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章讲解。" },
          ],
        },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第二章刚讲了一半",
          stopReason: "aborted",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true } },
            { type: "text", text: "第二章刚讲了一半" },
          ],
        },
      ],
    });

    render(<GuideWorkspace bookId="book-1" />);

    expect(screen.queryByTestId("guide-side-thread")).toBeNull();
    const incomplete = screen.getByTestId("guide-incomplete-step");
    expect(incomplete.getAttribute("data-status")).toBe("aborted");
    expect(screen.getByText("已中断")).toBeTruthy();
    expect(screen.getByText("第二章刚讲了一半")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(editPrompt).toHaveBeenCalledTimes(1));
    expect(editPrompt.mock.calls[0][0]).toBe(2);
    expect(editPrompt.mock.calls[0][2]).toEqual({
      selection: undefined,
      chapterHref: undefined,
      guideRequest: {},
    });
  });

  it("auto-collapses an older aborted guided step once a newer committed step succeeds", () => {
    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第一章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章讲解。" },
          ],
        },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "旧的中断半截内容",
          stopReason: "aborted",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t-abort", tool: "guide_step", params: {}, done: true } },
            { type: "text", text: "旧的中断半截内容" },
          ],
        },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第二章完整讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
            { type: "text", text: "第二章完整讲解。" },
          ],
        },
      ],
    });

    render(<GuideWorkspace bookId="book-1" />);

    expect(screen.queryByTestId("guide-side-thread")).toBeNull();
    expect(screen.getAllByTestId("guide-step-section")).toHaveLength(2);
    expect(screen.getByText("第二章完整讲解。")).toBeTruthy();

    // Superseded interrupted step collapses by default so the continuous reading flow stays clean.
    expect(screen.queryByText("旧的中断半截内容")).toBeNull();

    // Expanding it reveals the preserved aborted partial output.
    fireEvent.click(screen.getByRole("button", { name: "展开未完成的带读" }));
    expect(screen.getByText("旧的中断半截内容")).toBeTruthy();
  });
});
