// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";
import type { GuideStep } from "@/types/agent";

const newSession = vi.fn(async (_kind?: string) => {});
const prompt = vi.fn(async (..._args: unknown[]) => ({ requestId: "r", promptId: "p" }));
const editPrompt = vi.fn(async (..._args: unknown[]) => ({ requestId: "r", promptId: "p" }));
let nextStep: GuideStep | null = null;
const nextGuideStep = vi.fn(async (_startHref?: string) => nextStep);
const switchSession = vi.fn(async (_id: string) => {});
let afterChapter: GuideStep | null = null;
const guideStepAfterChapter = vi.fn(async (_step: GuideStep) => afterChapter);
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

import { ChatPanel } from "./ChatPanel";

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
    const skim = { ...stepOne, skim: true };
    expect(prompt).toHaveBeenCalledWith("略读：第三章", { guide: skim }, { role: "user", content: "略读：第三章", guide: skim });
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
