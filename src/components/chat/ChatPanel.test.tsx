// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const newSession = vi.fn(async () => {});
const switchSession = vi.fn(async () => {});
const renameSession = vi.fn(async () => {});
const deleteSession = vi.fn(async () => {});
const updateSessionConfig = vi.fn(async () => {});
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
    updateSessionConfig,
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
  updateSessionConfig.mockClear();
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

  it("opens session settings from the rail and saves the config", async () => {
    bridgeState = readyState({
      sessions: [
        { id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" },
        { id: "session-2", title: "另一会话", createdAt: "2", updatedAt: "2" },
      ],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    fireEvent.click(view.getAllByRole("button", { name: "会话设置" })[0]);
    expect(view.getByRole("dialog")).toBeTruthy();
    const dialog = view.getByRole("dialog");

    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "你是翻译助手" },
    });
    await act(async () => {
      within(dialog).getByRole("button", { name: "保存" }).click();
    });

    expect(updateSessionConfig).toHaveBeenCalledWith("session-1", "你是翻译助手");
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

  it("lists only user questions with normalized previews", () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一行\n  第二行" },
        { role: "assistant", content: "助手回答不应出现" },
        { role: "user", content: `${"很长的提问".repeat(15)}结尾` },
      ],
    });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    fireEvent.click(view.getByRole("button", { name: "对话目录" }));

    expect(view.queryByText("助手回答不应出现")).toBeTruthy();
    const toc = view.getByRole("complementary", { name: "对话目录" });
    expect(within(toc).getByText("第一行 第二行")).toBeTruthy();
    expect(within(toc).queryByText("助手回答不应出现")).toBeNull();
    expect(within(toc).getAllByRole("button", { name: /跳转到第/ })).toHaveLength(2);
    expect(within(toc).getAllByRole("button", { name: /跳转到第/ })[1].textContent).toContain("…");
  });

  it("smoothly jumps to a question, suspends streaming follow, and resumes at the bottom", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "第二问" },
      ],
    });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    scrollIntoView.mockClear();
    fireEvent.click(view.getByRole("button", { name: "对话目录" }));
    fireEvent.click(view.getByRole("button", { name: "跳转到第 1 条提问：第一问" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(view.queryByRole("complementary", { name: "对话目录" })).toBeNull();
    const container = view.getByTestId("chat-message-scroll");
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 600 },
    });
    fireEvent.scroll(container);
    scrollIntoView.mockClear();
    bridgeState = readyState({
      status: "prompting",
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "正在继续生成" },
        { role: "user", content: "第二问" },
      ],
    });
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent(container, new Event("scrollend"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("updates the current question while scrolling and resumes bottom follow", () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "第二问" },
      ],
    });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    const container = view.getByTestId("chat-message-scroll");
    const first = view.container.querySelector('[data-user-message-index="0"]') as HTMLElement;
    const second = view.container.querySelector('[data-user-message-index="2"]') as HTMLElement;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(100, 500));
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(80, 120));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(160, 200));
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 200 },
    });
    fireEvent.scroll(container);
    fireEvent.click(view.getByRole("button", { name: "对话目录" }));
    expect(view.getByRole("button", { name: "跳转到第 1 条提问：第一问" }).getAttribute("aria-current"))
      .toBe("location");

    fireEvent.click(view.getAllByRole("button", { name: "关闭对话目录" })[1]);
    container.scrollTop = 600;
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(90, 130));
    fireEvent.scroll(container);
    fireEvent.click(view.getByRole("button", { name: "对话目录" }));
    expect(view.getByRole("button", { name: "跳转到第 2 条提问：第二问" }).getAttribute("aria-current"))
      .toBe("location");
  });

  it("disables the outline for empty sessions and closes it on session or book switch", () => {
    bridgeState = readyState({ messages: [] });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect((view.getByRole("button", { name: "对话目录" }) as HTMLButtonElement).disabled).toBe(true);

    bridgeState = readyState({ messages: [{ role: "user", content: "旧会话问题" }] });
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    fireEvent.click(view.getByRole("button", { name: "对话目录" }));
    expect(view.getByRole("complementary", { name: "对话目录" })).toBeTruthy();
    bridgeState = readyState({
      sessionId: "session-2",
      messages: [{ role: "user", content: "新会话问题" }],
    });
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.queryByRole("complementary", { name: "对话目录" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "对话目录" }));
    expect(view.getByRole("complementary", { name: "对话目录" })).toBeTruthy();
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-2" />);
    expect(view.queryByRole("complementary", { name: "对话目录" })).toBeNull();
  });
});

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 200,
    bottom,
    width: 200,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

describe("ChatPanel compaction chip", () => {
  it("renders a compacting chip with spinner text", () => {
    bridgeState = readyState({ compaction: { status: "compacting" } });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.getByText("正在压缩上下文…")).toBeTruthy();
    expect(view.container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders a compacted chip without spinner", () => {
    bridgeState = readyState({ compaction: { status: "compacted" } });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.getByText("上下文已压缩")).toBeTruthy();
    expect(view.container.querySelector(".animate-spin")).toBeNull();
  });

  it("does not render a chip when compaction is null", () => {
    bridgeState = readyState({ compaction: null });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.queryByText("正在压缩上下文…")).toBeNull();
    expect(view.queryByText("上下文已压缩")).toBeNull();
  });
});
