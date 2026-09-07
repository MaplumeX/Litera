// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const editPrompt = vi.fn(async () => {});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    prompt: vi.fn(),
    editPrompt,
    renameSession: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    updateSessionConfig: vi.fn(async () => {}),
    switchBranchAtAnchor: vi.fn(async () => {}),
  }),
}));

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({
    snapshot: { configured: true },
    load: vi.fn(async () => {}),
  }),
}));

import { ChatPanel } from "./ChatPanel";

function readyState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    ...createAgentState("book-1"),
    status: "bookReady",
    sessionId: "session-1",
    sessions: [{ id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" }],
    ...overrides,
  };
}

beforeEach(() => {
  editPrompt.mockClear();
  bridgeState = readyState({
    messages: [
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问", selection: "引用段落", chapterHref: "OEBPS/ch2.xhtml" },
      { role: "assistant", content: "第二答" },
    ],
  });
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWorkspace() {
  return render(
    <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
  );
}

describe("ChatPanel regenerate", () => {
  it("resends the last user message through editPrompt with its context", async () => {
    const view = renderWorkspace();
    fireEvent.click(view.getByRole("button", { name: "重新生成" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(editPrompt).toHaveBeenCalledTimes(1);
    expect(editPrompt).toHaveBeenCalledWith(
      2,
      "第二问",
      { selection: "引用段落", chapterHref: "OEBPS/ch2.xhtml" },
      {
        role: "user",
        content: "第二问",
        selection: "引用段落",
        chapterHref: "OEBPS/ch2.xhtml",
      },
    );
  });

  it("anchors on the last user message even when the assistant reply is missing", async () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "出错前的问题" },
      ],
    });
    const view = renderWorkspace();
    fireEvent.click(view.getByRole("button", { name: "重新生成" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(editPrompt).toHaveBeenCalledWith(
      2,
      "出错前的问题",
      { selection: undefined, chapterHref: undefined },
      {
        role: "user",
        content: "出错前的问题",
        selection: undefined,
        chapterHref: undefined,
      },
    );
  });

  it("does not render the button while streaming", () => {
    bridgeState = readyState({
      status: "prompting",
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "生成中" },
      ],
    });
    const view = renderWorkspace();
    expect(view.queryByRole("button", { name: "重新生成" })).toBeNull();
  });

  it("does not render the button without user messages or in an empty session", () => {
    const view = renderWorkspace();

    bridgeState = readyState({ messages: [] });
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.queryByRole("button", { name: "重新生成" })).toBeNull();

    bridgeState = readyState({
      messages: [{ role: "assistant", content: "只有回答" }],
    });
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.queryByRole("button", { name: "重新生成" })).toBeNull();
  });

  it("does not render the button while the book is not ready", () => {
    bridgeState = readyState({ status: "loadingBook" });
    const view = renderWorkspace();
    expect(view.queryByRole("button", { name: "重新生成" })).toBeNull();
  });

  it("cancels an in-progress edit before regenerating", async () => {
    const view = renderWorkspace();
    fireEvent.click(view.getAllByRole("button", { name: "编辑" })[1]);
    expect(view.getByRole("button", { name: "保存" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "重新生成" }));
    await act(async () => {
      await Promise.resolve();
    });

    // The edit UI is gone and the resend used the last user message, not the draft.
    expect(view.queryByRole("button", { name: "保存" })).toBeNull();
    expect(editPrompt).toHaveBeenCalledWith(
      2,
      "第二问",
      expect.anything(),
      expect.anything(),
    );
  });
});
