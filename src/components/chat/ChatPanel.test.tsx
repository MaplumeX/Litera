// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const newSession = vi.fn(async () => {});
const switchSession = vi.fn(async () => {});
const renameSession = vi.fn(async () => {});
const deleteSession = vi.fn(async () => {});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession,
    newSession,
    prompt: vi.fn(),
    editPrompt: vi.fn(),
    renameSession,
    switchSession,
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
  newSession.mockClear();
  switchSession.mockClear();
  renameSession.mockClear();
  deleteSession.mockClear();
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

function openSessionList() {
  const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
  fireEvent.click(view.getByRole("button", { name: "会话列表" }));
  return view;
}

async function clickNewSession(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: "新建会话" }));
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ChatPanel new session", () => {
  it("reuses the current empty session without creating another one", async () => {
    bridgeState = readyState({ messages: [] });
    const view = openSessionList();

    await clickNewSession(view);

    expect(newSession).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(document.activeElement).toBe(view.getByPlaceholderText("输入问题…"));
  });

  it("creates a session when the current one already has messages", async () => {
    bridgeState = readyState({
      messages: [{ role: "user", content: "已有提问" }],
    });
    const view = openSessionList();

    await clickNewSession(view);

    expect(newSession).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(document.activeElement).toBe(view.getByPlaceholderText("输入问题…"));
  });

  it("creates a session when there is no active session", async () => {
    bridgeState = readyState({ sessionId: null, sessions: [], messages: [] });
    const view = openSessionList();

    await clickNewSession(view);

    expect(newSession).toHaveBeenCalledTimes(1);
    expect(switchSession).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(document.activeElement).toBe(view.getByPlaceholderText("输入问题…"));
  });
});

describe("ChatPanel session layouts", () => {
  it("shows an in-flow rail in workspace variant", () => {
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.getByRole("button", { name: "新建会话" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "关闭" })).toBeNull();
    const header = view.getByTestId("chat-panel-header");
    expect(header.className).toContain("border-b");
    expect(within(header).getByRole("heading", { name: "阅读助手" }).className).toContain(
      "font-semibold",
    );
  });

  it("keeps the overlay list in docked variant", () => {
    const view = openSessionList();
    expect(view.getByRole("button", { name: "关闭" })).toBeTruthy();
    expect(view.getByRole("button", { name: "新建会话" })).toBeTruthy();
    const header = view.getByTestId("chat-panel-header");
    expect(header.className).not.toContain("border-b");
    const title = within(header).getByRole("heading", { name: "阅读助手" });
    expect(title.className).toContain("font-medium");
    expect(title.className).not.toContain("font-semibold");
    expect(view.getByRole("button", { name: "会话列表" })).toBeTruthy();
    expect(view.getByRole("button", { name: "设置" })).toBeTruthy();
  });

  it("does not hide the message column when the rail collapses", () => {
    const view = render(
      <ChatPanel
        variant="workspace"
        sessionRailOpen={false}
        currentChapterHref="OEBPS/ch1.xhtml"
        bookId="book-1"
      />,
    );
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(view.getByPlaceholderText("输入问题…")).toBeTruthy();
  });

  it("switches, renames, and deletes from the rail", async () => {
    bridgeState = readyState({
      sessions: [
        { id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" },
        { id: "session-2", title: "另一会话", createdAt: "2", updatedAt: "2" },
      ],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    fireEvent.click(view.getByRole("button", { name: /另一会话/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(switchSession).toHaveBeenCalledWith("session-2");

    fireEvent.click(view.getAllByRole("button", { name: "重命名" })[0]);
    fireEvent.change(view.getByDisplayValue("新会话"), { target: { value: "新标题" } });
    fireEvent.click(view.getByText("保存"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(renameSession).toHaveBeenCalledWith("session-1", "新标题");

    fireEvent.click(view.getAllByText("删除")[0]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("creates a session from the workspace rail without closing it", async () => {
    bridgeState = readyState({
      messages: [{ role: "user", content: "已有提问" }],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    await clickNewSession(view);
    expect(newSession).toHaveBeenCalledTimes(1);
    expect(view.getByRole("button", { name: "新建会话" })).toBeTruthy();
  });
});

describe("ChatPanel scroll behavior", () => {
  it("jumps instantly to the bottom on session enter without smooth scrolling", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("smooth-scrolls to the bottom while streaming new content", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    scrollIntoView.mockClear();
    bridgeState = readyState({
      status: "prompting",
      messages: [{ role: "assistant", content: "正在生成" }],
    });
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
