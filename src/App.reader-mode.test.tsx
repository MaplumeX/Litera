// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationsFile, BookOpenContext } from "@/types/library";
import type { ReaderViewHandle } from "@/components/ReaderView";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";
import { DEFAULT_READER_MODE_KEY } from "@/lib/reader-mode";
import { AGENT_BOOK_WIDTH_KEY } from "@/lib/agent-book-width";
import { CHAT_PANEL_WIDTH_KEY } from "@/lib/chat-panel-width";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

const windowApi = {
  onCloseRequested: vi.fn(async () => () => {}),
  destroy: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

vi.mock("@/lib/use-open-paths", () => ({
  useOpenPaths: () => {},
}));

vi.mock("@/lib/use-book-import", () => ({
  useBookImport: () => ({
    notices: [],
    importing: false,
    confirmOpen: false,
    confirmRequest: null,
    dismissNotice: vi.fn(),
    settleConfirm: vi.fn(),
    importFromPaths: vi.fn(),
    pushNotice: vi.fn(),
  }),
}));

vi.mock("@/components/LibraryView", () => ({
  LibraryView: ({ onOpenBook }: { onOpenBook: (id: string) => void }) => (
    <button type="button" onClick={() => onOpenBook("book1")}>
      open-book
    </button>
  ),
}));

vi.mock("@/components/BookImportFeedback", () => ({
  BookImportConfirmDialog: () => null,
  BookImportNotices: () => null,
}));

const readerHandle: ReaderViewHandle = {
  prev: vi.fn(),
  next: vi.fn(),
  goToFraction: vi.fn(async () => {}),
  goToTocItem: vi.fn(),
  getSectionFractions: () => [],
  previewLabelAt: () => undefined,
  goToCfi: vi.fn(async () => true),
  setStyles: vi.fn(),
  getToc: () => [],
  getLocation: () => ({
    cfi: "epubcfi(/6/8!/4/2,/1:0,/1:80)",
    fraction: 0.42,
    label: "第三章",
  }),
  getSelectionCfi: () => ({
    cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)",
    excerpt: "selected sentence",
  }),
  addHighlight: vi.fn(),
  removeHighlight: vi.fn(),
};

vi.mock("@/components/ReaderView", async () => {
  const React = await import("react");
  return {
    ReaderView: React.forwardRef(function MockReader(
      props: {
        onSelectionCapture?: (capture: { text: string; chapterHref?: string }) => void;
      },
      ref: React.ForwardedRef<ReaderViewHandle>,
    ) {
      React.useImperativeHandle(ref, () => readerHandle);
      return (
        <div data-testid="reader-view">
          <button
            type="button"
            onClick={() => props.onSelectionCapture?.({ text: "quoted" })}
          >
            fake-ask
          </button>
        </div>
      );
    }),
  };
});

let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession: vi.fn(),
    newSession: vi.fn(),
    prompt: vi.fn(),
    editPrompt: vi.fn(),
    renameSession: vi.fn(),
    switchSession: vi.fn(),
  }),
}));

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({
    snapshot: { configured: true },
    load: vi.fn(async () => {}),
  }),
}));

import App from "./App";

const openContext: BookOpenContext = {
  name: "book.epub",
  title: "测试书",
  bookId: "book1",
  contentVersion: "v1",
  lastFraction: 0.1,
};

const emptyFile: AnnotationsFile = {
  schemaVersion: 1,
  bookmarks: [],
  highlights: [],
};

function setupInvoke() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_book_open_context") return Promise.resolve({ ...openContext });
    if (cmd === "open_book_bytes") return Promise.resolve(new ArrayBuffer(8));
    if (cmd === "get_annotations") return Promise.resolve(emptyFile);
    if (cmd === "save_annotations") return Promise.resolve(undefined);
    if (cmd === "update_reading_state") return Promise.resolve(undefined);
    if (cmd === "list_system_fonts") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
}

async function openReader() {
  const screen = render(<App />);
  await act(async () => {
    fireEvent.click(screen.getByText("open-book"));
  });
  await waitFor(() => {
    expect(screen.getByTestId("reader-view")).toBeTruthy();
  });
  return screen;
}

beforeEach(() => {
  invokeMock.mockReset();
  windowApi.onCloseRequested.mockClear();
  openContext.lastReaderMode = undefined;
  bridgeState = {
    ...createAgentState("book1"),
    status: "bookReady",
    sessionId: "session-1",
    sessions: [{ id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" }],
  };
  setupInvoke();
  localStorage.removeItem(DEFAULT_READER_MODE_KEY);
  localStorage.removeItem(AGENT_BOOK_WIDTH_KEY);
  localStorage.removeItem(CHAT_PANEL_WIDTH_KEY);
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(DEFAULT_READER_MODE_KEY);
  localStorage.removeItem(AGENT_BOOK_WIDTH_KEY);
  localStorage.removeItem(CHAT_PANEL_WIDTH_KEY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reader / agent mode", () => {
  it("opens in reader mode when nothing is saved", async () => {
    const screen = await openReader();
    expect(screen.getByLabelText("切换到 Agent 模式")).toBeTruthy();
    expect(screen.getByLabelText("显示对话")).toBeTruthy();
    const bookCell = screen.getByTestId("reader-book-cell");
    expect(bookCell.contains(screen.getByTestId("reader-progress-bar"))).toBe(true);
    expect(bookCell.lastElementChild).toBe(screen.getByTestId("reader-progress-bar"));
    expect(screen.getAllByTestId("reader-progress-bar")).toHaveLength(1);
    expect(screen.getByText("Chapter 1")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
    expect((screen.getByLabelText("上一章") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("下一章") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("reader-shell").style.gridTemplateAreas).toBe('"book chat"');
  });

  it("uses the settings default when the book has no memory", async () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "agent");
    const screen = await openReader();
    expect(screen.getByLabelText("切换到阅读模式")).toBeTruthy();
    expect(screen.getByLabelText("会话列表")).toBeTruthy();
    expect(screen.queryByLabelText("显示会话列表")).toBeNull();
    expect(screen.queryByLabelText("隐藏会话列表")).toBeNull();
    expect(screen.getByLabelText("隐藏书籍")).toBeTruthy();
    expect(screen.getByTestId("reader-book-cell").contains(screen.getByTestId("reader-progress-bar"))).toBe(true);
    expect(screen.getByTestId("reader-shell").style.gridTemplateAreas).toBe('"chat book"');
    expect(screen.getByTestId("reader-shell").style.gridTemplateColumns).toBe("1fr 38%");
    expect(screen.getByRole("button", { name: "新建会话" })).toBeTruthy();
  });

  it("lets book lastReaderMode win over the app default", async () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "reader");
    openContext.lastReaderMode = "agent";
    const screen = await openReader();
    expect(screen.getByLabelText("切换到阅读模式")).toBeTruthy();
    expect(screen.queryByLabelText("显示对话")).toBeNull();
  });

  it("does not rewrite book memory when the settings default changes", async () => {
    openContext.lastReaderMode = "reader";
    const screen = await openReader();
    expect(screen.getByLabelText("切换到 Agent 模式")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("字体与主题"));
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    fireEvent.click(screen.getByRole("radio", { name: "Agent" }));

    expect(localStorage.getItem(DEFAULT_READER_MODE_KEY)).toBe("agent");
    expect(screen.getByLabelText("切换到 Agent 模式")).toBeTruthy();
    expect(
      invokeMock.mock.calls.some(
        (call) =>
          call[0] === "update_reading_state" &&
          Boolean((call[1] as { lastReaderMode?: string } | undefined)?.lastReaderMode),
      ),
    ).toBe(false);
  });

  it("keeps ReaderView and ChatPanel mounted and preserves the input draft", async () => {
    const screen = await openReader();
    const reader = screen.getByTestId("reader-view");
    const chat = screen.getByTestId("chat-panel");
    const input = screen.getByPlaceholderText("输入问题…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "草稿还在" } });

    fireEvent.click(screen.getByLabelText("切换到 Agent 模式"));

    expect(screen.getByTestId("reader-view")).toBe(reader);
    expect(screen.getByTestId("chat-panel")).toBe(chat);
    expect((screen.getByPlaceholderText("输入问题…") as HTMLTextAreaElement).value).toBe(
      "草稿还在",
    );
    expect(screen.getByLabelText("切换到阅读模式")).toBeTruthy();
  });

  it("persists the per-book mode on toggle", async () => {
    const screen = await openReader();
    fireEvent.click(screen.getByLabelText("切换到 Agent 模式"));
    await waitFor(
      () => {
        expect(invokeMock).toHaveBeenCalledWith(
          "update_reading_state",
          expect.objectContaining({ bookId: "book1", lastReaderMode: "agent" }),
        );
      },
      { timeout: 1500 },
    );
  });

  it("collapses the session rail and book without covering chat", async () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "agent");
    const screen = await openReader();
    expect(screen.getByRole("button", { name: "新建会话" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("会话列表"));
    expect(screen.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(screen.getByPlaceholderText("输入问题…")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("隐藏书籍"));
    expect(screen.getByTestId("reader-shell").style.gridTemplateColumns).toBe("1fr 0px");
    expect(screen.getByTestId("reader-view")).toBeTruthy();
    expect(screen.getByPlaceholderText("输入问题…")).toBeTruthy();
  });

  it("fills chat immediately when asking the agent with the book open", async () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "agent");
    const screen = await openReader();
    fireEvent.click(screen.getByText("fake-ask"));
    await waitFor(() => {
      expect(screen.getByText("引用选段：“quoted”")).toBeTruthy();
    });
  });

  it("does not fill chat when the agent-mode book is collapsed", async () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "agent");
    const screen = await openReader();
    fireEvent.click(screen.getByLabelText("隐藏书籍"));
    fireEvent.click(screen.getByText("fake-ask"));
    expect(screen.queryByText("引用选段：“quoted”")).toBeNull();
  });

  it("resizes the agent book pane and persists the width", async () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "agent");
    const screen = await openReader();
    const shell = screen.getByTestId("reader-shell");
    vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON() {
        return {};
      },
    });
    const handle = screen.getByRole("separator", { name: "调整书籍宽度" });
    fireEvent.pointerDown(handle, { clientX: 620, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 580, button: 0 });
    fireEvent.pointerUp(handle, { clientX: 580, button: 0 });
    expect(shell.style.gridTemplateColumns).toBe("1fr 42%");
    expect(localStorage.getItem(AGENT_BOOK_WIDTH_KEY)).toBe("42");
  });

  it("opens TOC by expanding a collapsed agent-mode book", async () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "agent");
    const screen = await openReader();
    fireEvent.click(screen.getByLabelText("隐藏书籍"));
    expect(screen.getByTestId("reader-shell").style.gridTemplateColumns).toBe("1fr 0px");
    fireEvent.click(screen.getByLabelText("目录"));
    expect(screen.getByTestId("reader-shell").style.gridTemplateColumns).toBe("1fr 38%");
    expect(screen.getByTestId("reader-book-cell").hidden).toBe(false);
    expect(screen.getByLabelText("关闭目录")).toBeTruthy();
  });

  it("re-entering agent mode opens the list and the book", async () => {
    const screen = await openReader();
    fireEvent.click(screen.getByLabelText("切换到 Agent 模式"));
    fireEvent.click(screen.getByLabelText("会话列表"));
    fireEvent.click(screen.getByLabelText("隐藏书籍"));
    fireEvent.click(screen.getByLabelText("切换到阅读模式"));
    fireEvent.click(screen.getByLabelText("切换到 Agent 模式"));
    expect(screen.getByLabelText("会话列表")).toBeTruthy();
    expect(screen.getByLabelText("隐藏书籍")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建会话" })).toBeTruthy();
    expect(screen.getByTestId("reader-shell").style.gridTemplateColumns).toBe("1fr 38%");
  });
});
