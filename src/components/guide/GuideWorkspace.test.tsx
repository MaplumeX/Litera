// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "@/lib/agent-reducer";
import type { GuideStep } from "@/types/agent";

const prompt = vi.fn();
const askSideQuestion = vi.fn();
const editPrompt = vi.fn();
const editSideTurn = vi.fn();
const regenerateTurn = vi.fn();
const regenerateSideTurn = vi.fn();
const reviseStep = vi.fn();
const selectStepRevision = vi.fn();
const undoLatestStep = vi.fn();
const dismissIncompleteTail = vi.fn();
const rollbackToChapterRun = vi.fn();
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
const switchSideBranchAtAnchor = vi.fn();
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
    askSideQuestion,
    editTurn: editPrompt,
    editSideTurn,
    regenerateTurn,
    regenerateSideTurn,
    reviseStep,
    selectStepRevision,
    undoLatestStep,
    dismissIncompleteTail,
    rollbackToChapterRun,
    abort,
    switchBranchAtAnchor,
    switchSideBranchAtAnchor,
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
    sideThreads: {},
    activeSideThreadKey: null,
    stepRevisions: {},
    activeRevisionTarget: null,
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

  it("focuses the latest chapter by default, mounts only one chapter at a time, and switches chapters via the chapter bar", async () => {
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

    // Only the latest chapter run is mounted initially.
    expect(screen.getAllByTestId("guide-chapter-group")).toHaveLength(1);
    expect(screen.getAllByTestId("guide-step-section")).toHaveLength(1);
    // Mechanical "继续带读" user bubbles must NOT appear in the document body.
    expect(screen.queryByText("继续带读")).toBeNull();
    expect(screen.queryByText("第一章的核心论述。")).toBeNull();
    expect(screen.getByText("第二章的展开。")).toBeTruthy();
    // Latest step's side thread is expanded by default.
    expect(screen.getByText("第二章和第一章怎么呼应？")).toBeTruthy();
    expect(screen.queryByTestId("guide-jump-latest")).toBeNull();

    // Switch back to Chapter 1 via the previous-chapter button.
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));

    expect(screen.getAllByTestId("guide-chapter-group")).toHaveLength(1);
    expect(screen.getByText("第一章的核心论述。")).toBeTruthy();
    expect(screen.queryByText("第二章的展开。")).toBeNull();
    expect(screen.getByTestId("guide-jump-latest")).toBeTruthy();

    // Older step's side thread is collapsed by default and expands on click.
    expect(screen.queryByText("为什么作者这样定义？")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /追问/ }));
    expect(screen.getByText("为什么作者这样定义？")).toBeTruthy();
    expect(screen.getByText("因为作者基于历史脉络。")).toBeTruthy();

    // Clicking "回到最新" returns to Chapter 2.
    fireEvent.click(screen.getByTestId("guide-jump-latest"));
    expect(screen.getByText("第二章的展开。")).toBeTruthy();
    expect(screen.queryByTestId("guide-jump-latest")).toBeNull();
  });

  it("hides the chapter bar on desktop with nav rail open when only one chapter run exists, and shows it when rail is closed or docked", () => {
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

    const { rerender } = render(
      <GuideWorkspace
        bookId="book-1"
        variant="workspace"
        navRailOpen
        renderNavRail={() => <aside data-testid="mock-rail" />}
      />,
    );
    expect(screen.queryByTestId("guide-chapter-bar")).toBeNull();

    rerender(
      <GuideWorkspace
        bookId="book-1"
        variant="workspace"
        navRailOpen={false}
        renderNavRail={() => <aside data-testid="mock-rail" />}
      />,
    );
    expect(screen.getByTestId("guide-chapter-bar")).toBeTruthy();

    rerender(<GuideWorkspace bookId="book-1" variant="docked" />);
    expect(screen.getByTestId("guide-chapter-bar")).toBeTruthy();
  });

  it("searches across unmounted chapters in the chapter switcher and jumps directly to the matching question", async () => {
    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第一章讨论制度变迁。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章讨论制度变迁。" },
          ],
        },
        { role: "user", content: "什么是路径依赖？" },
        { role: "assistant", content: "历史选择会锁定后续演进方向。" },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第二章讨论现代转型。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
            { type: "text", text: "第二章讨论现代转型。" },
          ],
        },
      ],
    });

    render(<GuideWorkspace bookId="book-1" />);
    expect(screen.getByText("第二章讨论现代转型。")).toBeTruthy();
    expect(screen.queryByText("什么是路径依赖？")).toBeNull();

    fireEvent.click(screen.getByTestId("guide-chapter-switcher"));
    const searchInput = await screen.findByTestId("guide-chapter-search");
    fireEvent.change(searchInput, { target: { value: "路径依赖" } });

    const hit = await screen.findByTestId("guide-search-hit");
    fireEvent.click(hit);

    expect(screen.getByText("第一章讨论制度变迁。")).toBeTruthy();
    expect(screen.getByText("什么是路径依赖？")).toBeTruthy();
    expect(screen.getByText("历史选择会锁定后续演进方向。")).toBeTruthy();
  });

  it("supports imperative cross-chapter scrollToMessage and snaps back to latest when continuing from history", async () => {
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
        { role: "user", content: "第一章的追问" },
        { role: "assistant", content: "第一章的回答" },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第二章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
            { type: "text", text: "第二章讲解。" },
          ],
        },
      ],
    });

    const ref = createRef<GuideWorkspaceHandle>();
    render(<GuideWorkspace ref={ref} bookId="book-1" />);

    expect(screen.getByText("第二章讲解。")).toBeTruthy();

    // Imperatively jump to the side question in Chapter 1 (messageIndex 2).
    act(() => {
      ref.current?.scrollToMessage(2);
    });
    expect(screen.getByText("第一章讲解。")).toBeTruthy();
    expect(screen.getByText("第一章的追问")).toBeTruthy();

    // Pressing Continue while viewing Chapter 1 snaps back to the latest chapter.
    await waitFor(() => expect(screen.getByRole("button", { name: /继续/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(screen.getByText("第二章讲解。")).toBeTruthy();
    expect(prompt).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(regenerateTurn).toHaveBeenCalledTimes(1));
    expect(regenerateTurn).toHaveBeenCalledWith(0);
    expect(editPrompt).not.toHaveBeenCalled();
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
    await waitFor(() => expect(regenerateTurn).toHaveBeenCalledTimes(1));
    expect(regenerateTurn).toHaveBeenCalledWith(2);
    expect(editPrompt).not.toHaveBeenCalled();
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
    expect(screen.getAllByTestId("guide-step-section")).toHaveLength(1);
    expect(screen.getByText("第二章完整讲解。")).toBeTruthy();

    // Navigate back to Chapter 1 where the superseded interrupted step sits.
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));

    // Superseded interrupted step collapses by default so the continuous reading flow stays clean.
    expect(screen.queryByText("旧的中断半截内容")).toBeNull();

    // Expanding it reveals the preserved aborted partial output.
    fireEvent.click(screen.getByRole("button", { name: "展开未完成的带读" }));
    expect(screen.getByText("旧的中断半截内容")).toBeTruthy();
  });

  it("keeps chapter follow-up questions inside the viewed historical chapter and passes its run anchor without jumping to latest", async () => {
    askSideQuestion.mockResolvedValue({ requestId: "req-1", promptId: "p-1" });
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
          content: "第二章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
            { type: "text", text: "第二章讲解。" },
          ],
        },
      ],
      branchAnchors: ["u-ch1", "a-ch1", "u-ch2", "a-ch2"],
      sideThreads: {
        "u-ch1": {
          messages: [
            { role: "user", content: "第一章专属追问" },
            { role: "assistant", content: "第一章专属回答" },
          ],
          anchors: ["sq-1", "sa-1"],
          navigation: {},
        },
      },
    });

    render(<GuideWorkspace bookId="book-1" />);

    // Viewing Chapter 2 does NOT show Chapter 1's follow-up.
    expect(screen.getByText("第二章讲解。")).toBeTruthy();
    expect(screen.queryByTestId("guide-side-thread")).toBeNull();
    expect(screen.queryByText("第一章专属追问")).toBeNull();

    // Switch back to Chapter 1: Chapter 1's side-thread lives here.
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));
    expect(screen.getByText("第一章讲解。")).toBeTruthy();
    expect(screen.getByTestId("guide-side-thread")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开追问" }));
    expect(screen.getByText("第一章专属追问")).toBeTruthy();

    // Asking a new follow-up while viewing Chapter 1 stays on Chapter 1 and targets "u-ch1".
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "再细讲一下第一章的伏笔" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(askSideQuestion).toHaveBeenCalledTimes(1));
    expect(askSideQuestion).toHaveBeenCalledWith("再细讲一下第一章的伏笔", {
      selection: undefined,
      chapterHref: undefined,
      sideThreadAnchorId: "u-ch1",
    });
    // Still viewing Chapter 1 (never snapped back to Chapter 2).
    expect(screen.getByText("第一章讲解。")).toBeTruthy();
    expect(screen.queryByText("第二章讲解。")).toBeNull();
  });

  it("revises a historical chapter step in place without jumping to latest or rewinding spine, and switches local revisions", async () => {
    reviseStep.mockResolvedValue({ requestId: "req-rev", promptId: "p-rev", revisionId: "rev-2" });
    selectStepRevision.mockResolvedValue(undefined);
    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第一章原版讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章原版讲解。" },
          ],
        },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第二章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
            { type: "text", text: "第二章讲解。" },
          ],
        },
      ],
      branchAnchors: ["u-ch1", "a-ch1", "u-ch2", "a-ch2"],
      stepRevisions: {
        "a-ch1": {
          targetAnchorId: "a-ch1",
          activeRevisionId: "rev-1",
          revisions: [
            {
              revisionId: "rev-1",
              timestamp: "2026-04-01T00:05:00Z",
              pace: "deep",
              content: "第一章深入修订版。",
              blocks: [{ type: "text", text: "第一章深入修订版。" }],
            },
          ],
        },
      },
    });

    render(<GuideWorkspace bookId="book-1" />);

    // Flip back to Chapter 1: shows the active revision ("第一章深入修订版。") and semantic pill.
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));
    expect(screen.getByText("第一章深入修订版。")).toBeTruthy();
    const revSwitcher = screen.getByTestId("guide-step-revision-switcher");
    expect(revSwitcher.textContent).toContain("深入");

    // Switch back to original version locally.
    fireEvent.click(revSwitcher);
    const options = screen.getAllByTestId("guide-step-revision-option");
    expect(options[0].textContent).toContain("原版");
    fireEvent.click(options[0]);
    await waitFor(() => expect(selectStepRevision).toHaveBeenCalledWith("a-ch1", "__original__"));

    // Trigger an intentful in-place revision on Chapter 1 ("compact"): stays on Chapter 1 and never calls spine regenerateTurn.
    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    expect(screen.queryByTestId("guide-step-undo-latest")).toBeNull();
    fireEvent.click(screen.getByTestId("guide-reexplain-pace-compact"));
    await waitFor(() => expect(reviseStep).toHaveBeenCalledWith("a-ch1", { pace: "compact" }));
    expect(regenerateTurn).not.toHaveBeenCalled();
    expect(screen.getByText("第一章深入修订版。")).toBeTruthy();
    expect(screen.queryByText("第二章讲解。")).toBeNull();
  });

  it("supports dismissing an incomplete tail attempt and undoing strictly the latest committed step", async () => {
    dismissIncompleteTail.mockResolvedValue(undefined);
    undoLatestStep.mockResolvedValue(undefined);
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
          content: "",
          stopReason: "error",
          errorMessage: "网络超时",
        },
      ],
      branchAnchors: ["u-ch1", "a-ch1", "u-err", "a-err"],
    });

    const { rerender } = render(<GuideWorkspace bookId="book-1" />);
    fireEvent.click(screen.getByTestId("guide-incomplete-dismiss"));
    await waitFor(() => expect(dismissIncompleteTail).toHaveBeenCalledTimes(1));

    // Once tail incomplete attempt is gone, Chapter 1 step becomes latest and offers undo.
    mockState = makeGuidedState({
      messages: mockState.messages.slice(0, 2),
      branchAnchors: ["u-ch1", "a-ch1"],
    });
    rerender(<GuideWorkspace bookId="book-1" />);
    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    fireEvent.click(screen.getByTestId("guide-step-undo-latest"));
    await waitFor(() => expect(undoLatestStep).toHaveBeenCalledTimes(1));
  });

  it("folds repeated chapter passes in GuideChapterBar and gates chapter rollback behind confirmation", async () => {
    guideStepAnchor.mockResolvedValue({ chapterIndex: 0, href: "ch1.xhtml", snippet: "a", target: { hrefs: ["ch1.xhtml"], key: "a", occurrence: 0 } });
    guideStepAtHref.mockResolvedValue(step0);
    rollbackToChapterRun.mockResolvedValue(undefined);

    mockState = makeGuidedState({
      messages: [
        { role: "user", content: "开始带读", guideRequest: { step: step0 } },
        {
          role: "assistant",
          content: "第一章第一遍。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章第一遍。" },
          ],
        },
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第二章讲解。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
            { type: "text", text: "第二章讲解。" },
          ],
        },
        { role: "user", content: "重读第一章", guideRequest: { step: step0 } },
        {
          role: "assistant",
          content: "第一章第二遍。",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "t3", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章第二遍。" },
          ],
        },
      ],
      branchAnchors: ["u-ch1-1", "a-ch1-1", "u-ch2", "a-ch2", "u-ch1-2", "a-ch1-2"],
    });

    render(<GuideWorkspace bookId="book-1" />);

    // Viewing pass 2 of Chapter 1 shows folded pass badge.
    expect(screen.getByTestId("guide-chapter-pass-badge").textContent).toContain("第 2 遍");

    // Opening chapter switcher folds Chapter 1's two passes into one group.
    fireEvent.click(screen.getByTestId("guide-chapter-switcher"));
    expect(screen.getAllByTestId("guide-chapter-folded-group")).toHaveLength(1);
    const passButtons = screen.getAllByTestId("guide-chapter-option");
    // Switch to pass 1 of Chapter 1.
    fireEvent.click(passButtons[0]);
    expect(screen.getByText("第一章第一遍。")).toBeTruthy();

    // Destructive chapter rollback requires explicit confirmation and displays affected count (2 downstream runs).
    fireEvent.click(screen.getByTestId("guide-chapter-actions-trigger"));
    fireEvent.click(screen.getByTestId("guide-chapter-action-rollback"));
    expect(rollbackToChapterRun).not.toHaveBeenCalled();
    expect(screen.getByText(/2 个章节记录/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("guide-chapter-rollback-confirm"));
    await waitFor(() => expect(rollbackToChapterRun).toHaveBeenCalledWith("u-ch1-1"));

    // Non-destructive chapter re-read triggers guideChapter without confirmation.
    fireEvent.click(screen.getByTestId("guide-chapter-actions-trigger"));
    fireEvent.click(screen.getByTestId("guide-chapter-action-reread"));
    await waitFor(() => expect(guideStepAtHref).toHaveBeenCalledWith("ch1.xhtml"));
  });
});
