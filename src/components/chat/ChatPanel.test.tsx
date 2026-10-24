// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function twoQuestionMessages(): AgentState["messages"] {
  return [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
    { role: "user", content: "第二问" },
  ];
}

function renderWorkspace() {
  return render(
    <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
  );
}

function openSessionList() {
  const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
  fireEvent.click(view.getByRole("button", { name: "会话列表" }));
  return view;
}

/** Opens the first session's ⋯ menu and picks an item by name. */
async function chooseSessionAction(view: ReturnType<typeof render>, name: string) {
  fireEvent.keyDown(view.getAllByRole("button", { name: "会话操作" })[0], { key: "Enter" });
  const item = await waitFor(() => view.getByRole("menuitem", { name }));
  act(() => {
    item.click();
  });
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
    // The reader titlebar names the book and toggles the rail: no panel header.
    expect(view.queryByTestId("chat-panel-header")).toBeNull();
    expect(view.queryByText("会话列表")).toBeNull();
    expect(view.getByRole("button", { name: "模型" })).toBeTruthy();
  });

  it("opens the session list as a popover from the input row in docked variant", () => {
    const view = openSessionList();
    // Dismissed from where it opens, so it needs no close button.
    expect(view.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(view.getByRole("button", { name: "新建会话" })).toBeTruthy();
    // No header row: the session button and model switcher sit in the input row.
    expect(view.queryByTestId("chat-panel-header")).toBeNull();
    expect(view.queryByText("已就绪")).toBeNull();
    expect(view.getByRole("button", { name: "会话列表" }).getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("button", { name: "模型" })).toBeTruthy();
    // Provider setup lives in the model switcher, not as a toolbar button.
    expect(view.queryByRole("button", { name: "设置" })).toBeNull();
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

    await chooseSessionAction(view, "重命名");
    fireEvent.change(view.getByDisplayValue("新会话"), { target: { value: "新标题" } });
    fireEvent.keyDown(view.getByDisplayValue("新标题"), { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renameSession).toHaveBeenCalledWith("session-1", "新标题");

    await chooseSessionAction(view, "删除");
    // Deletion is permanent, so it waits for confirmation.
    const confirm = await waitFor(() => view.getByRole("alertdialog"));
    expect(within(confirm).getByText("删除「新会话」？")).toBeTruthy();
    expect(deleteSession).not.toHaveBeenCalled();
    await act(async () => {
      within(confirm).getByRole("button", { name: "删除" }).click();
    });
    expect(deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("saves the rename on blur and cancels on empty title", async () => {
    bridgeState = readyState({
      sessions: [
        { id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" },
      ],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    await chooseSessionAction(view, "重命名");
    const input = view.getByDisplayValue("新会话");
    fireEvent.change(input, { target: { value: "失焦保存" } });
    fireEvent.blur(input);
    await act(async () => {
      await Promise.resolve();
    });
    expect(renameSession).toHaveBeenCalledWith("session-1", "失焦保存");
    expect(view.queryByDisplayValue("失焦保存")).toBeNull();

    renameSession.mockClear();
    await chooseSessionAction(view, "重命名");
    const emptyInput = view.getByDisplayValue("新会话");
    fireEvent.change(emptyInput, { target: { value: "   " } });
    fireEvent.blur(emptyInput);
    await act(async () => {
      await Promise.resolve();
    });
    expect(renameSession).not.toHaveBeenCalled();
    expect(view.queryByDisplayValue("   ")).toBeNull();
  });

  it("cancels the rename on Escape without saving", async () => {
    bridgeState = readyState({
      sessions: [
        { id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" },
      ],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    await chooseSessionAction(view, "重命名");
    const input = view.getByDisplayValue("新会话");
    fireEvent.change(input, { target: { value: "不保存的标题" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    await act(async () => {
      await Promise.resolve();
    });
    expect(renameSession).not.toHaveBeenCalled();
    expect(view.queryByDisplayValue("不保存的标题")).toBeNull();
  });

  it("saves a blur rename after a previous edit was committed via Enter", async () => {
    bridgeState = readyState({
      sessions: [
        { id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" },
      ],
    });
    const view = render(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    // First edit: commit via Enter with an empty title (cancels, input unmounts
    // without blur consuming the committed flag).
    await chooseSessionAction(view, "重命名");
    const emptyInput = view.getByDisplayValue("新会话");
    fireEvent.change(emptyInput, { target: { value: "" } });
    fireEvent.keyDown(emptyInput, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renameSession).not.toHaveBeenCalled();

    // Second edit: blur-save must still work.
    renameSession.mockClear();
    await chooseSessionAction(view, "重命名");
    const input = view.getByDisplayValue("新会话");
    fireEvent.change(input, { target: { value: "第二次失焦" } });
    fireEvent.blur(input);
    await act(async () => {
      await Promise.resolve();
    });
    expect(renameSession).toHaveBeenCalledWith("session-1", "第二次失焦");
  });

  it("closes the docked popover after switching sessions", async () => {
    bridgeState = readyState({
      sessions: [
        { id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" },
        { id: "session-2", title: "另一会话", createdAt: "2", updatedAt: "2" },
      ],
    });
    const view = openSessionList();
    fireEvent.click(view.getByRole("button", { name: /另一会话/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(switchSession).toHaveBeenCalledWith("session-2");
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
  });

  it("keeps the session when deletion is cancelled", async () => {
    bridgeState = readyState({
      sessions: [{ id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" }],
    });
    const view = renderWorkspace();
    await chooseSessionAction(view, "删除");
    const confirm = await waitFor(() => view.getByRole("alertdialog"));
    act(() => {
      within(confirm).getByRole("button", { name: "取消" }).click();
    });
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    expect(deleteSession).not.toHaveBeenCalled();
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

    await chooseSessionAction(view, "会话设置");
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

  it("lists only user questions on the workspace rail", () => {
    bridgeState = readyState({
      messages: [
        { role: "user", content: "第一行\n  第二行" },
        { role: "assistant", content: "助手回答不应出现" },
        { role: "user", content: `${"很长的提问".repeat(15)}结尾` },
      ],
    });
    const view = renderWorkspace();
    const rail = view.getByRole("navigation", { name: "对话目录" });
    expect(view.getByText("助手回答不应出现")).toBeTruthy();
    expect(within(rail).queryByText("助手回答不应出现")).toBeNull();
    expect(within(rail).getAllByRole("button", { name: /跳转到第/ })).toHaveLength(2);
    expect(
      view.getByRole("button", { name: /跳转到第 2 条提问：/ }).getAttribute("aria-label"),
    ).toContain("…");
  });

  it("smoothly jumps to a question, keeps the rail, suspends streaming follow, and resumes at the bottom", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    bridgeState = readyState({ messages: twoQuestionMessages() });
    const view = renderWorkspace();
    scrollIntoView.mockClear();
    fireEvent.click(view.getByRole("button", { name: "跳转到第 1 条提问：第一问" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(view.getByRole("navigation", { name: "对话目录" })).toBeTruthy();
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
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent(container, new Event("scrollend"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("updates the current tick while scrolling", () => {
    bridgeState = readyState({ messages: twoQuestionMessages() });
    const view = renderWorkspace();
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
    expect(view.getByRole("button", { name: "跳转到第 1 条提问：第一问" }).getAttribute("aria-current"))
      .toBe("location");

    container.scrollTop = 600;
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(90, 130));
    fireEvent.scroll(container);
    expect(view.getByRole("button", { name: "跳转到第 2 条提问：第二问" }).getAttribute("aria-current"))
      .toBe("location");
  });

  it("shows a focus preview for one workspace tick", () => {
    bridgeState = readyState({ messages: twoQuestionMessages() });
    const view = renderWorkspace();
    const tick = view.getByRole("button", { name: "跳转到第 1 条提问：第一问" });
    fireEvent.focus(tick);
    expect(view.getByTestId("chat-outline-preview").textContent).toBe("第一问");
    fireEvent.blur(tick);
    expect(view.queryByTestId("chat-outline-preview")).toBeNull();
  });

  it("hides the workspace rail for empty sessions and a single user question", () => {
    bridgeState = readyState({ messages: [] });
    const view = renderWorkspace();
    expect(view.queryByTestId("chat-outline-rail")).toBeNull();
    expect(view.queryByRole("button", { name: "对话目录" })).toBeNull();

    bridgeState = readyState({ messages: [{ role: "user", content: "仅一条" }] });
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.queryByTestId("chat-outline-rail")).toBeNull();

    bridgeState = readyState({ messages: twoQuestionMessages() });
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.getByTestId("chat-outline-rail")).toBeTruthy();
  });

  it("does not leak outline preview across session or book changes", () => {
    vi.useFakeTimers();
    bridgeState = readyState({
      messages: [
        { role: "user", content: "旧会话问题" },
        { role: "assistant", content: "旧答" },
        { role: "user", content: "旧会话第二问" },
      ],
    });
    const view = renderWorkspace();
    fireEvent.pointerEnter(view.getByTestId("chat-outline-rail"), { clientX: 8, clientY: 20 });
    fireEvent.pointerEnter(view.getByTestId("chat-outline-slot-0"));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(view.getByTestId("chat-outline-preview").textContent).toBe("旧会话问题");

    bridgeState = readyState({
      sessionId: "session-2",
      messages: [
        { role: "user", content: "新会话问题" },
        { role: "assistant", content: "新答" },
        { role: "user", content: "新会话第二问" },
      ],
    });
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.queryByTestId("chat-outline-preview")).toBeNull();
    expect(view.queryByText("旧会话问题")).toBeNull();

    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-2" />,
    );
    expect(view.queryByTestId("chat-outline-preview")).toBeNull();
  });

  it("does not render outline UI in the docked reader chat", () => {
    bridgeState = readyState({ messages: twoQuestionMessages() });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.queryByRole("button", { name: "对话目录" })).toBeNull();
    expect(view.queryByTestId("chat-outline-rail")).toBeNull();
    expect(view.queryByRole("navigation", { name: "对话目录" })).toBeNull();
    expect(view.queryByRole("complementary", { name: "对话目录" })).toBeNull();
  });

  it("reserves a left gutter only when the workspace outline rail is mounted", () => {
    function paddingTokens(view: ReturnType<typeof render>) {
      return view.getByTestId("chat-message-scroll").className.split(/\s+/);
    }

    bridgeState = readyState({ messages: twoQuestionMessages() });
    const view = renderWorkspace();
    expect(view.getByTestId("chat-outline-rail")).toBeTruthy();
    expect(paddingTokens(view)).toContain("pl-12");
    expect(paddingTokens(view)).toContain("py-3");
    expect(paddingTokens(view)).toContain("pr-3");
    expect(paddingTokens(view)).not.toContain("p-3");

    bridgeState = readyState({ messages: [] });
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.queryByTestId("chat-outline-rail")).toBeNull();
    expect(paddingTokens(view)).toContain("p-3");
    expect(paddingTokens(view)).not.toContain("pl-12");

    bridgeState = readyState({ messages: [{ role: "user", content: "仅一条" }] });
    view.rerender(
      <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    expect(view.queryByTestId("chat-outline-rail")).toBeNull();
    expect(paddingTokens(view)).toContain("p-3");
    expect(paddingTokens(view)).not.toContain("pl-12");

    bridgeState = readyState({ messages: twoQuestionMessages() });
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.queryByTestId("chat-outline-rail")).toBeNull();
    expect(paddingTokens(view)).toContain("p-3");
    expect(paddingTokens(view)).not.toContain("pl-12");
  });

  it("marks the message flow container so nested scrollbars hide via CSS", () => {
    // 滚动条隐藏本身靠全局样式表（jsdom 不算样式）；这里验证的是
    // 接线：滚动容器带上 chat-message-scroll class，无论是否有大纲栏。
    function classTokens(view: ReturnType<typeof render>) {
      return view.getByTestId("chat-message-scroll").className.split(/\s+/);
    }

    bridgeState = readyState({ messages: twoQuestionMessages() });
    const view = renderWorkspace();
    expect(classTokens(view)).toContain("chat-message-scroll");
    expect(classTokens(view)).toContain("overflow-y-auto");

    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(classTokens(view)).toContain("chat-message-scroll");
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

describe("ChatPanel compaction status", () => {
  it("renders a pending divider with a spinner while compacting", () => {
    bridgeState = readyState({ compaction: { status: "compacting" } });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(within(view.getByTestId("compaction-status")).getByText("正在压缩上下文…")).toBeTruthy();
    expect(view.getByTestId("compaction-status").querySelector(".animate-spin")).toBeTruthy();
  });

  it("says why the answer restarts when a request overflowed", () => {
    bridgeState = readyState({ compaction: { status: "recovering" } });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(within(view.getByTestId("compaction-status")).getByText("上下文超出限制，正在压缩后重新回答…")).toBeTruthy();
  });

  it("renders a failure line without a spinner", () => {
    bridgeState = readyState({ compaction: { status: "failed" } });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.getByText("上下文压缩失败，下次回答后会重试")).toBeTruthy();
    expect(view.getByTestId("compaction-status").querySelector(".animate-spin")).toBeNull();
  });

  it("renders nothing when compaction is null", () => {
    bridgeState = readyState({ compaction: null });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    expect(view.queryByTestId("compaction-status")).toBeNull();
  });
});

describe("ChatPanel compaction notice", () => {
  it("renders the durable notice while keeping the compacted-away history visible", () => {
    bridgeState = readyState({
      compaction: null,
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "notice", summary: "## Goal\n保留要点", tokensBefore: 1234 },
        { role: "user", content: "第二问" },
      ],
    });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    const notice = view.getByTestId("compaction-notice");
    expect(within(notice).getByText("上下文已压缩")).toBeTruthy();
    // The pre-compaction turns are still in the transcript.
    expect(view.getByText("第一问")).toBeTruthy();
    expect(view.getByText("第一答")).toBeTruthy();
    expect(view.queryByTestId("compaction-notice-summary")).toBeNull();
  });

  it("expands to show the summary the model sees", () => {
    bridgeState = readyState({
      compaction: null,
      messages: [
        { role: "user", content: "第一问" },
        { role: "notice", summary: "## Goal\n保留要点", tokensBefore: 1234 },
      ],
    });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    fireEvent.click(within(view.getByTestId("compaction-notice")).getByRole("button"));
    const summary = view.getByTestId("compaction-notice-summary");
    expect(summary.textContent).toContain("保留要点");
    // The summary renders as Markdown, not as raw source.
    expect(within(summary).getByRole("heading", { name: "Goal" })).toBeTruthy();
    expect(summary.textContent).not.toContain("##");
  });
});

describe("ChatPanel chapter recap", () => {
  it("shows a collapsed recap marker that expands to the recap", () => {
    bridgeState = readyState({
      compaction: null,
      messages: [
        { role: "user", content: "带读：第一章" },
        { role: "assistant", content: "第一章复述" },
        { role: "recap", chapterIndex: 0, chapterTitle: "第一章", text: "- 要点**一**" },
      ],
    });
    const view = render(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);
    const recap = view.getByTestId("guide-recap");
    expect(within(recap).getByText("本章回顾：第一章")).toBeTruthy();
    expect(view.queryByTestId("guide-recap-text")).toBeNull();
    fireEvent.click(within(recap).getByRole("button"));
    expect(view.getByTestId("guide-recap-text").textContent?.trim()).toBe("要点一");
    // The answer before the marker is still the last chat turn: it can be regenerated.
    expect(view.getByRole("button", { name: /重新生成/ })).toBeTruthy();
  });
});
