// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";
import type { GuideSelection, GuideStep } from "@/types/agent";

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
const picked: GuideStep = { ...{ chapterIndex: 2, part: 0, totalParts: 3, chapterTitle: "第三章" }, range: { from: { chapterIndex: 2, chapterTitle: "第三章", block: 0 }, to: { chapterIndex: 2, chapterTitle: "第三章", block: 1 } } };
let selectionResult: { step: GuideStep } | { error: "before" | "notFound" } = { step: picked };
const guideStepToSelection = vi.fn(async (_step: GuideStep, _selection: GuideSelection) => selectionResult);
const guideStepTo = vi.fn(async (_step: GuideStep, _to: { chapterIndex: number; block: number }, _skim?: boolean): Promise<GuideStep | null> => picked);
const guideStepAt = vi.fn(async (_href: string): Promise<GuideStep | null> => ({ chapterIndex: 6, part: 0, totalParts: 2, chapterTitle: "第七章" }));
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
    guideStepAt,
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

const stepOne: GuideStep = { chapterIndex: 2, part: 0, totalParts: 3, chapterTitle: "第三章" };

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
  guideStepAt.mockClear();
  afterChapter = { chapterIndex: 3, part: 0, totalParts: 1, chapterTitle: "第四章" };
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
    expect(prompt).toHaveBeenCalledWith(label, { guide: stepOne }, { role: "user", content: label, guide: stepOne });
  });

  it("continues once started, and cannot edit a guided step", async () => {
    nextStep = { ...stepOne, part: 1 };
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "带读：第三章（第 1/3 部分）", guide: stepOne },
        { role: "assistant", content: "讲述" },
      ],
    });
    const view = renderPanel();
    expect(await view.findByRole("button", { name: "继续：第三章 · 2/3" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("regenerates a guided step with its guide", async () => {
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "带读：第三章（第 1/3 部分）", guide: stepOne },
        { role: "assistant", content: "讲述" },
      ],
    });
    const view = renderPanel();
    fireEvent.click(view.getByRole("button", { name: "重新生成" }));
    await waitFor(() => expect(editPrompt).toHaveBeenCalled());
    expect(editPrompt.mock.calls[0][2]).toMatchObject({ guide: stepOne });
  });

  it("skims the rest of the chapter in one step", async () => {
    const view = renderPanel();
    fireEvent.click(await view.findByRole("button", { name: "略读本章" }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(guideSkimStep).toHaveBeenCalledWith(stepOne);
    const skim = { ...stepOne, skim: true };
    expect(prompt).toHaveBeenCalledWith("略读：第三章", { guide: skim }, { role: "user", content: "略读：第三章", guide: skim });
  });

  it("reads up to the paragraph the reader picks", async () => {
    const view = renderPanel();
    fireEvent.click(await view.findByRole("button", { name: "选择这一步读到哪里" }));
    fireEvent.click((await view.findByText("第二段")).closest("button")!);
    fireEvent.click(view.getByRole("button", { name: "带读" }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(guideOutline).toHaveBeenCalledWith(stepOne, undefined);
    expect(guideStepTo).toHaveBeenCalledWith(stepOne, { chapterIndex: 2, block: 1 }, false);
    expect(prompt).toHaveBeenCalledWith("带读：第三章（第 1–2 段）", { guide: picked }, { role: "user", content: "带读：第三章（第 1–2 段）", guide: picked });
  });

  it("reads up to a selection from the book", async () => {
    const ref = createRef<ChatPanelHandle>();
    const view = render(<ChatPanel ref={ref} variant="workspace" currentChapterHref="OEBPS/ch3.xhtml" bookId="book-1" />);
    await view.findByRole("button", { name: "开始带读：第三章" });
    await act(async () => { ref.current!.guideTo({ text: "第二", paragraph: "第二段", chapterHref: "OEBPS/ch3.xhtml#s2" }); });
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(guideStepToSelection).toHaveBeenCalledWith(stepOne, { text: "第二", paragraph: "第二段", chapterHref: "OEBPS/ch3.xhtml#s2" });
    expect(prompt.mock.calls[0][1]).toEqual({ guide: picked });
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
    expect(prompt.mock.calls[0][1]).toEqual({ guide: afterChapter });
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
  it("reads on from a chapter freshly picked in the TOC", async () => {
    const view = render(<ChatPanel bookId="book-1" variant="workspace" chapterScope={null} />);
    await view.findByRole("button", { name: "开始带读：第三章" });
    view.rerender(<ChatPanel bookId="book-1" variant="workspace" chapterScope={{ label: "第七章", href: "OEBPS/ch7.xhtml" }} />);
    expect(await view.findByRole("button", { name: "开始带读：第七章" })).toBeTruthy();
    expect(guideStepAt).toHaveBeenCalledWith("OEBPS/ch7.xhtml");
  });

  it("ignores a scope left over from before the session opened", async () => {
    const view = render(<ChatPanel bookId="book-1" variant="workspace" chapterScope={{ label: "第七章", href: "OEBPS/ch7.xhtml" }} />);
    await view.findByRole("button", { name: "开始带读：第三章" });
    expect(guideStepAt).not.toHaveBeenCalled();
  });

  it("reports the steps on the active branch, and null outside a Guided session", async () => {
    const onGuideStepsChange = vi.fn();
    bridgeState = guidedState({
      messages: [
        { role: "user", content: "带读", guide: stepOne },
        { role: "assistant", content: "讲述" },
        { role: "user", content: "插话" },
      ],
    });
    const view = render(<ChatPanel bookId="book-1" onGuideStepsChange={onGuideStepsChange} />);
    expect(onGuideStepsChange).toHaveBeenLastCalledWith([stepOne]);
    bridgeState = guidedState({ sessions: [{ id: "guided-1", title: "t", createdAt: "1", updatedAt: "1" }] });
    view.rerender(<ChatPanel bookId="book-1" onGuideStepsChange={onGuideStepsChange} />);
    await waitFor(() => expect(onGuideStepsChange).toHaveBeenLastCalledWith(null));
  });
});
