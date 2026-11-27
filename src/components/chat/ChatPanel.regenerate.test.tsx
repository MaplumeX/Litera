// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const editPrompt = vi.fn(async () => {});
const regeneratePrompt = vi.fn(async () => {});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    prompt: vi.fn(),
    editPrompt,
    regeneratePrompt,
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
  regeneratePrompt.mockClear();
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
  it("regenerates the last user turn through regeneratePrompt without duplicating the user message", async () => {
    const view = renderWorkspace();
    const buttons = view.getAllByRole("button", { name: "重新生成" });
    fireEvent.click(buttons[buttons.length - 1]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(regeneratePrompt).toHaveBeenCalledTimes(1);
    expect(regeneratePrompt).toHaveBeenCalledWith(2);
    expect(editPrompt).not.toHaveBeenCalled();
  });

  it("regenerates an earlier assistant message anchored to its own preceding user message", async () => {
    const view = renderWorkspace();
    const buttons = view.getAllByRole("button", { name: "重新生成" });
    fireEvent.click(buttons[0]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(regeneratePrompt).toHaveBeenCalledTimes(1);
    expect(regeneratePrompt).toHaveBeenCalledWith(0);
    expect(editPrompt).not.toHaveBeenCalled();
  });

  it("anchors on the last user message even when a compaction notice trails the reply", async () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "notice", summary: "sum", tokensBefore: 10 },
      ],
    });
    const view = renderWorkspace();
    const buttons = view.getAllByRole("button", { name: "重新生成" });
    fireEvent.click(buttons[buttons.length - 1]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(regeneratePrompt).toHaveBeenCalledWith(0);
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
    const buttons = view.getAllByRole("button", { name: "重新生成" });
    fireEvent.click(buttons[buttons.length - 1]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(regeneratePrompt).toHaveBeenCalledWith(2);
  });

  it("retries an empty-output errored assistant message via the inline retry button", async () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "", blocks: [], stopReason: "error", errorMessage: "模型服务暂时不可用，请稍后重试" },
      ],
    });
    const view = renderWorkspace();
    const retryButton = view.getByRole("button", { name: "重试" });
    fireEvent.click(retryButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(regeneratePrompt).toHaveBeenCalledTimes(1);
    expect(regeneratePrompt).toHaveBeenCalledWith(0);
    expect(editPrompt).not.toHaveBeenCalled();
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

  it("renders the button inside every assistant message that follows a user message", () => {
    const view = renderWorkspace();
    const buttons = view.getAllByRole("button", { name: "重新生成" });
    expect(buttons).toHaveLength(2);
    // 位于每条 assistant 消息气泡内（与复制按钮同一按钮行）
    const copyButtons = view.getAllByRole("button", { name: "复制" });
    expect(copyButtons).toHaveLength(2);
    expect(buttons[0].parentElement).toBe(copyButtons[0].parentElement);
    expect(buttons[1].parentElement).toBe(copyButtons[1].parentElement);
  });

  it("renders regenerate buttons for all mid-conversation assistant messages", () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "第二问" },
        { role: "assistant", content: "第二答" },
        { role: "user", content: "第三问" },
        { role: "assistant", content: "第三答" },
      ],
    });
    const view = renderWorkspace();
    expect(view.getAllByRole("button", { name: "重新生成" })).toHaveLength(3);
  });

  it("keeps the fallback button available when the last message is a user message", async () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "出错前的问题" },
      ],
    });
    const view = renderWorkspace();
    const buttons = view.getAllByRole("button", { name: "重新生成" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[buttons.length - 1]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(regeneratePrompt).toHaveBeenCalledWith(2);
  });

  it("renders the fallback button when the last assistant message has no text blocks", async () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        {
          role: "assistant",
          content: "",
          blocks: [{ type: "toolCall", toolCall: { toolCallId: "t1", tool: "search", params: {}, done: true } }],
        },
      ],
    });
    const view = renderWorkspace();
    const button = view.getByRole("button", { name: "重新生成" });
    expect(button).toBeTruthy();
    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });

    expect(regeneratePrompt).toHaveBeenCalledWith(0);
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

    const buttons = view.getAllByRole("button", { name: "重新生成" });
    fireEvent.click(buttons[buttons.length - 1]);
    await act(async () => {
      await Promise.resolve();
    });

    // The edit UI is gone and the resend targeted the last user message, not the draft.
    expect(view.queryByRole("button", { name: "保存" })).toBeNull();
    expect(regeneratePrompt).toHaveBeenCalledWith(2);
  });
});
