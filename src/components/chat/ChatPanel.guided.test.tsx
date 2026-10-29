// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";
import { isLegacyGuideStep, type GuideSelection, type GuideStep, type RecordedGuideStep } from "@/types/agent";

const newSession = vi.fn(async (_kind?: string) => {});
const prompt = vi.fn(async (..._args: unknown[]) => ({ requestId: "r", promptId: "p" }));
const editPrompt = vi.fn(async (..._args: unknown[]) => ({ requestId: "r", promptId: "p" }));
let nextStep: GuideStep | null = null;
const nextGuideStep = vi.fn(async (_startHref?: string) => nextStep);
const switchSession = vi.fn(async (_id: string) => {});
let afterChapter: GuideStep | null = null;
const guideStepAfterChapter = vi.fn(async (_step: GuideStep) => afterChapter);
const guideSkimStep = vi.fn(async (step: GuideStep): Promise<GuideStep | null> => ({ ...step, skim: true }));
const guideOutline = vi.fn(async (_step: GuideStep, _after?: number) => ({
  chapters: [{ chapterIndex: 2, chapterTitle: "第三章", firstBlock: 0, blocks: [{ snippet: "开头一段", chars: 40, heading: 0, part: 0 }, { snippet: "第二段", chars: 60, heading: 0, part: 0 }] }],
  more: null,
}));
const three = { chapterIndex: 2, chapterTitle: "第三章" };
/** Part `index` of 第三章, three blocks to a part. */
const partStep = (index: number): GuideStep => ({ from: { ...three, block: index * 3 }, to: { ...three, block: index * 3 + 2 }, part: { index, total: 3 } });
const picked: GuideStep = { from: { ...three, block: 0 }, to: { ...three, block: 1 } };
let selectionResult: { step: GuideStep } | { error: "before" | "notFound" } = { step: picked };
const guideStepToSelection = vi.fn(async (_step: GuideStep, _selection: GuideSelection) => selectionResult);
const guideStepTo = vi.fn(async (_step: GuideStep, _to: { chapterIndex: number; block: number }, _skim?: boolean): Promise<GuideStep | null> => picked);
const seventh = { chapterIndex: 6, chapterTitle: "第七章" };
const guideStepAnchor = vi.fn(async (step: RecordedGuideStep) => {
  const part = isLegacyGuideStep(step) ? step.part : step.part?.index ?? 0;
  const snippet = part ? "第二部分开头" : "第一部分开头";
  return { chapterIndex: isLegacyGuideStep(step) ? step.chapterIndex : step.from.chapterIndex, href: "OEBPS/ch3.xhtml", snippet, target: { hrefs: ["OEBPS/ch3.xhtml"], key: snippet, occurrence: part } } as { chapterIndex: number; href?: string; snippet: string; target: { hrefs: string[]; key: string; occurrence: number } } | null;
});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession: vi.fn(),
    newSession,
    nextGuideStep,
    guideStepAfterChapter,
    guideSkimStep,
    guideOutline,
    guideStepTo,
    guideStepToSelection,
    guideStepAnchor,
    prompt,
    editPrompt,
    renameSession: vi.fn(),
    switchSession,
    updateSessionConfig: vi.fn(),
  }),
}));

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({ snapshot: { configured: true }, load: vi.fn(async () => {}) }),
}));

import { ChatPanel, type ChatPanelHandle } from "./ChatPanel";

const stepOne = partStep(0);
/** The same step as Sessions recorded it on the reader's message before steps were block ranges. */
const legacyOne = { ...three, part: 0, totalParts: 3 };

function guidedState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    ...createAgentState("book-1"),
    status: "bookReady",
    sessionId: "guided-1",
    sessions: [{ id: "guided-1", title: "新会话", createdAt: "1", updatedAt: "1", kind: "guided" }],
    ...overrides,
  };
}

function renderPanel() {
  return render(<ChatPanel variant="workspace" currentChapterHref="OEBPS/ch3.xhtml" bookId="book-1" />);
}

beforeEach(() => {
  newSession.mockClear();
  prompt.mockClear();
  editPrompt.mockClear();
  nextGuideStep.mockClear();
  switchSession.mockClear();
  guideStepAfterChapter.mockClear();
  guideSkimStep.mockClear();
  guideOutline.mockClear();
  guideStepTo.mockClear();
  guideStepToSelection.mockClear();
  selectionResult = { step: picked };
  guideStepAnchor.mockClear();
  afterChapter = { from: { chapterIndex: 3, chapterTitle: "第四章", block: 0 }, to: { chapterIndex: 3, chapterTitle: "第四章", block: 2 }, part: { index: 0, total: 1 } };
  nextStep = stepOne;
  bridgeState = guidedState();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatPanel in a Guided session", () => {
  it("offers to start from the chapter in scope and sends the step", async () => {
    const view = renderPanel();
    const start = await view.findByRole("button", { name: "开始带读：第三章" });
    expect(nextGuideStep).toHaveBeenCalledWith("OEBPS/ch3.xhtml");
    fireEvent.click(start);
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    const label = "带读：第三章（第 1/3 部分）";
    expect(prompt).toHaveBeenCalledWith(label, { guideRequest: { step: stepOne } }, { role: "user", content: label, guideRequest: { step: stepOne } });
  });

  it("continues with a plain request once the assistant has taken a step, leaving the step to it", async () => {
    nextStep = partStep(1);
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "开始带读：第三章", guideRequest: { step: stepOne } },
        { role: "assistant", content: "讲述", blocks: [{ type: "toolCall", toolCall: { toolCallId: "c1", tool: "guide_step", params: {}, done: true, guide: stepOne } }, { type: "text", text: "讲述" }] },
      ],
    });
    const view = renderPanel();
    fireEvent.click(await view.findByRole("button", { name: "继续：第三章 · 2/3" }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(prompt).toHaveBeenCalledWith("继续带读", { guideRequest: {} }, { role: "user", content: "继续带读", guideRequest: {} });
    // The step the assistant took is the marker; the request is a quiet bubble that cannot be edited.
    expect(view.getByTestId("guide-step").textContent).toBe("带读：第三章（第 1/3 部分）");
    expect(view.getByText("开始带读：第三章")).toBeTruthy();
    expect(view.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("marks every step the assistant took, also on request in its own words, and opens its start in the Book", async () => {
    const two: GuideStep = partStep(1);
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "带读第三章前两部分" },
        {
          role: "assistant",
          content: "讲述",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "c1", tool: "guide_step", params: {}, done: true, guide: stepOne } },
            { type: "toolCall", toolCall: { toolCallId: "c2", tool: "guide_step", params: {}, done: true, guide: two } },
            { type: "text", text: "讲述" },
          ],
        },
      ],
    });
    const onOpenQuote = vi.fn();
    const view = render(<ChatPanel variant="workspace" bookId="book-1" onOpenQuote={onOpenQuote} />);
    const markers = view.getAllByTestId("guide-step");
    expect(markers.map((marker) => marker.textContent)).toEqual(["带读：第三章（第 1/3 部分）在书中打开", "带读：第三章（第 2/3 部分）在书中打开"]);
    fireEvent.click(view.getAllByRole("button", { name: "在书中打开" })[1]);
    await waitFor(() => expect(onOpenQuote).toHaveBeenCalled());
    expect(guideStepAnchor).toHaveBeenCalledWith(two);
    // The Book pane counts to the paragraph; the text is only its fallback.
    expect(onOpenQuote).toHaveBeenCalledWith({ status: "verified", chapterIndex: 2, href: "OEBPS/ch3.xhtml" }, "第二部分开头", { hrefs: ["OEBPS/ch3.xhtml"], key: "第二部分开头", occurrence: 1 });
  });

  it("says so when a step's start cannot be found in the Book", async () => {
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        { role: "assistant", content: "讲述", blocks: [{ type: "toolCall", toolCall: { toolCallId: "c1", tool: "guide_step", params: {}, done: true, guide: stepOne } }] },
      ],
    });
    guideStepAnchor.mockResolvedValueOnce(null);
    const onOpenQuote = vi.fn();
    const view = render(<ChatPanel variant="workspace" bookId="book-1" onOpenQuote={onOpenQuote} />);
    fireEvent.click(view.getByRole("button", { name: "在书中打开" }));
    expect(await view.findByRole("button", { name: "未能在书中定位" })).toBeTruthy();
    expect(onOpenQuote).not.toHaveBeenCalled();
  });

  it("continues once started, and cannot edit a guided step", async () => {
    nextStep = partStep(1);
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "带读：第三章（第 1/3 部分）", guide: legacyOne },
        { role: "assistant", content: "讲述" },
      ],
    });
    const view = renderPanel();
    expect(await view.findByRole("button", { name: "继续：第三章 · 2/3" })).toBeTruthy();
    // The sent step is a transcript marker, not the reader's bubble.
    expect(view.getByTestId("guide-step").textContent).toBe("带读：第三章（第 1/3 部分）");
    expect(view.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("regenerates a step sent in an older Session as a request for it", async () => {
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "带读：第三章（第 1/3 部分）", guide: legacyOne },
        { role: "assistant", content: "讲述" },
      ],
    });
    const view = renderPanel();
    fireEvent.click(view.getByRole("button", { name: "重新生成" }));
    await waitFor(() => expect(editPrompt).toHaveBeenCalled());
    expect(editPrompt.mock.calls[0][2]).toEqual({ guideRequest: { step: legacyOne } });
  });

  it("regenerates a Continue with its request", async () => {
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        { role: "assistant", content: "讲述" },
      ],
    });
    const view = renderPanel();
    fireEvent.click(view.getByRole("button", { name: "重新生成" }));
    await waitFor(() => expect(editPrompt).toHaveBeenCalled());
    expect(editPrompt.mock.calls[0][2]).toEqual({ guideRequest: {} });
  });

  it("skims the rest of the chapter in one step", async () => {
    const view = renderPanel();
    fireEvent.click(await view.findByRole("button", { name: "略读本章" }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(guideSkimStep).toHaveBeenCalledWith(stepOne);
    const skim = { ...stepOne, skim: true };
    expect(prompt).toHaveBeenCalledWith("略读：第三章", { guideRequest: { step: skim } }, { role: "user", content: "略读：第三章", guideRequest: { step: skim } });
  });

  it("reads up to the paragraph the reader picks", async () => {
    const view = renderPanel();
    fireEvent.click(await view.findByRole("button", { name: "读到…" }));
    fireEvent.click((await view.findByText("第二段")).closest("button")!);
    fireEvent.click(view.getByRole("button", { name: "带读" }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(guideOutline).toHaveBeenCalledWith(stepOne, undefined);
    expect(guideStepTo).toHaveBeenCalledWith(stepOne, { chapterIndex: 2, block: 1 }, false);
    expect(prompt).toHaveBeenCalledWith("带读：第三章（第 1–2 段）", { guideRequest: { step: picked } }, { role: "user", content: "带读：第三章（第 1–2 段）", guideRequest: { step: picked } });
  });

  it("reads up to a selection from the book", async () => {
    const ref = createRef<ChatPanelHandle>();
    const view = render(<ChatPanel ref={ref} variant="workspace" currentChapterHref="OEBPS/ch3.xhtml" bookId="book-1" />);
    await view.findByRole("button", { name: "开始带读：第三章" });
    await act(async () => { ref.current!.guideTo({ text: "第二", paragraph: "第二段", chapterHref: "OEBPS/ch3.xhtml#s2" }); });
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(guideStepToSelection).toHaveBeenCalledWith(stepOne, { text: "第二", paragraph: "第二段", chapterHref: "OEBPS/ch3.xhtml#s2" });
    expect(prompt.mock.calls[0][1]).toEqual({ guideRequest: { step: picked } });
  });

  it("explains why a selection cannot end the step", async () => {
    const ref = createRef<ChatPanelHandle>();
    const view = render(<ChatPanel ref={ref} variant="workspace" currentChapterHref="OEBPS/ch3.xhtml" bookId="book-1" />);
    await view.findByRole("button", { name: "开始带读：第三章" });
    selectionResult = { error: "before" };
    await act(async () => { ref.current!.guideTo({ text: "开头", chapterHref: "OEBPS/ch3.xhtml" }); });
    expect(await view.findByText("选中的位置已经带读过了。带读只能往后读，不会留下空缺。")).toBeTruthy();
    selectionResult = { error: "notFound" };
    await act(async () => { ref.current!.guideTo({ text: "找不到", chapterHref: "OEBPS/ch3.xhtml" }); });
    expect(await view.findByText("没能在书里找到选中的文字，换一段试试。")).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("skips a chapter without sending anything, then reads on from there", async () => {
    const view = renderPanel();
    fireEvent.click(await view.findByRole("button", { name: "跳过本章" }));
    const start = await view.findByRole("button", { name: "开始带读：第四章" });
    expect(guideStepAfterChapter).toHaveBeenCalledWith(stepOne);
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.click(start);
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(prompt.mock.calls[0][1]).toEqual({ guideRequest: { step: afterChapter } });
  });

  it("says so at the end of the Book", async () => {
    nextStep = null;
    const view = renderPanel();
    expect(await view.findByText("已带读到全书末尾")).toBeTruthy();
  });

  it("creates Guided sessions from the rail and marks them with their position", async () => {
    bridgeState = guidedState({
      sessionId: "chat-1",
      sessions: [
        { id: "chat-1", title: "普通会话", createdAt: "1", updatedAt: "1" },
        { id: "guided-1", title: "带读会话", createdAt: "1", updatedAt: "1", kind: "guided", guide: stepOne },
      ],
    });
    const view = renderPanel();
    expect(view.queryByRole("button", { name: /开始带读/ })).toBeNull();
    expect(view.getByText("第三章 · 1/3")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "新建带读" }));
    expect(newSession).toHaveBeenCalledWith("guided");
  });

  it("starts a fresh ordinary Session instead of reusing an empty Guided one", () => {
    const view = renderPanel();
    fireEvent.click(view.getByRole("button", { name: "新建会话" }));
    expect(newSession).toHaveBeenCalledWith();
  });
});

describe("ChatPanel on open", () => {
  const sessions: AgentState["sessions"] = [
    { id: "chat-new", title: "普通", createdAt: "2", updatedAt: "2" },
    { id: "guided-old", title: "带读", createdAt: "1", updatedAt: "1", kind: "guided" },
  ];

  it("resumes the latest Guided session in Agent mode", () => {
    bridgeState = guidedState({ sessionId: null, sessions });
    render(<ChatPanel bookId="book-1" preferGuidedSession />);
    expect(switchSession).toHaveBeenCalledWith("guided-old");
  });

  it("opens the latest Session otherwise", () => {
    bridgeState = guidedState({ sessionId: null, sessions });
    render(<ChatPanel bookId="book-1" />);
    expect(switchSession).toHaveBeenCalledWith("chat-new");
  });

  it("opens the latest Session in Agent mode when the book has no Guided session", () => {
    bridgeState = guidedState({ sessionId: null, sessions: [sessions[0]] });
    render(<ChatPanel bookId="book-1" preferGuidedSession />);
    expect(switchSession).toHaveBeenCalledWith("chat-new");
  });
});

describe("ChatPanel and the TOC in a Guided session", () => {
  it("reports the steps on the active branch, and null outside a Guided session", async () => {
    const onGuideStepsChange = vi.fn();
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "带读", guide: stepOne },
        { role: "assistant", content: "讲述" },
        { role: "user", content: "插话" },
        { role: "assistant", content: "回答" },
        { role: "user", content: "继续带读", guideRequest: {} },
        { role: "assistant", content: "讲述", blocks: [{ type: "toolCall", toolCall: { toolCallId: "c1", tool: "guide_step", params: {}, done: true, guide: partStep(1) } }] },
      ],
    });
    const view = render(<ChatPanel bookId="book-1" onGuideStepsChange={onGuideStepsChange} />);
    expect(onGuideStepsChange).toHaveBeenLastCalledWith([stepOne, partStep(1)]);
    bridgeState = guidedState({ sessions: [{ id: "guided-1", title: "t", createdAt: "1", updatedAt: "1" }] });
    view.rerender(<ChatPanel bookId="book-1" onGuideStepsChange={onGuideStepsChange} />);
    await waitFor(() => expect(onGuideStepsChange).toHaveBeenLastCalledWith(null));
  });
});
