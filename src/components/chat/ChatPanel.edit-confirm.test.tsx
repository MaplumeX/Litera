// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const editPrompt = vi.fn(async () => {});
const prompt = vi.fn(async () => {});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    prompt,
    editPrompt,
    renameSession: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    updateSessionConfig: vi.fn(async () => {}),
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
  prompt.mockClear();
  editPrompt.mockClear();
  bridgeState = readyState();
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

describe("ChatPanel message edit confirm button", () => {
  it("clicking the save button calls editPrompt with the edited text", async () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
      ],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    // 进入编辑模式
    fireEvent.click(view.getByRole("button", { name: "编辑" }));
    const textarea = view
      .getAllByRole("textbox")
      .find((el) => (el as HTMLTextAreaElement).value === "第一问") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("第一问");

    // 修改内容并点击确认（保存）按钮
    fireEvent.change(textarea, { target: { value: "改写后的问题" } });
    fireEvent.click(view.getByRole("button", { name: "保存" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(editPrompt).toHaveBeenCalledTimes(1);
    expect(editPrompt).toHaveBeenCalledWith(
      0,
      "改写后的问题",
      { selection: undefined, chapterHref: undefined },
      { role: "user", content: "改写后的问题", selection: undefined, chapterHref: undefined },
    );
  });

  it("save button is disabled for empty drafts and does not call editPrompt", async () => {
    bridgeState = readyState({
      messages: [{ role: "user", content: "第一问" }],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    fireEvent.click(view.getByRole("button", { name: "编辑" }));
    const textarea = view
      .getAllByRole("textbox")
      .find((el) => (el as HTMLTextAreaElement).value === "第一问") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: "   " } });

    const saveButton = view.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.click(saveButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(editPrompt).not.toHaveBeenCalled();
  });

  it("Enter key submits the edit the same as the confirm button", async () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
      ],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    fireEvent.click(view.getByRole("button", { name: "编辑" }));
    const textarea = view
      .getAllByRole("textbox")
      .find((el) => (el as HTMLTextAreaElement).value === "第一问") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: "回车提交" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(editPrompt).toHaveBeenCalledTimes(1);
    expect(editPrompt).toHaveBeenCalledWith(
      0,
      "回车提交",
      expect.anything(),
      expect.anything(),
    );
  });
});
