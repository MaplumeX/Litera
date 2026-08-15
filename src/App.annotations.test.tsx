// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationsFile, BookOpenContext } from "@/types/library";
import type { ReaderViewHandle } from "@/components/ReaderView";

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

vi.mock("@/components/settings/SettingsDialog", () => ({
  SettingsDialog: () => null,
}));

vi.mock("@/components/BookImportFeedback", () => ({
  BookImportConfirmDialog: () => null,
  BookImportNotices: () => null,
}));

const fillInput = vi.fn();

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
        onHighlight?: (selection: { cfi: string; excerpt: string }) => void;
        onSelectionCapture?: (capture: { text: string; chapterHref?: string }) => void;
      },
      ref: React.ForwardedRef<ReaderViewHandle>,
    ) {
      React.useImperativeHandle(ref, () => readerHandle);
      return (
        <>
          <button
            type="button"
            onClick={() =>
              props.onHighlight?.({
                cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)",
                excerpt: "selected sentence",
              })
            }
          >
            fake-highlight
          </button>
          <button
            type="button"
            onClick={() => props.onSelectionCapture?.({ text: "quoted" })}
          >
            fake-ask
          </button>
        </>
      );
    }),
  };
});

vi.mock("@/components/chat/ChatPanel", async () => {
  const React = await import("react");
  return {
    ChatPanel: React.forwardRef(function MockChat(
      _props: unknown,
      ref: React.ForwardedRef<{ fillInput: (text: string, chapterHref?: string) => void }>,
    ) {
      React.useImperativeHandle(ref, () => ({ fillInput }));
      return <div />;
    }),
  };
});

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
    if (cmd === "get_book_open_context") return Promise.resolve(openContext);
    if (cmd === "open_book_bytes") return Promise.resolve(new ArrayBuffer(8));
    if (cmd === "get_annotations") return Promise.resolve(emptyFile);
    if (cmd === "save_annotations") return Promise.resolve(undefined);
    if (cmd === "update_reading_state") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  });
}

async function openReader() {
  const screen = render(<App />);
  await act(async () => {
    fireEvent.click(screen.getByText("open-book"));
  });
  await waitFor(() => {
    expect(screen.getByLabelText("标注")).toBeTruthy();
  });
  return screen;
}

beforeEach(() => {
  invokeMock.mockReset();
  fillInput.mockReset();
  windowApi.onCloseRequested.mockClear();
  windowApi.destroy.mockClear();
  windowApi.close.mockClear();
  windowApi.minimize.mockClear();
  windowApi.toggleMaximize.mockClear();
  setupInvoke();
  localStorage.removeItem("litera.chat-panel-width");
  localStorage.removeItem("litera.defaultReaderMode");
  localStorage.removeItem("litera.agent-book-width");
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
  localStorage.removeItem("litera.chat-panel-width");
  localStorage.removeItem("litera.defaultReaderMode");
  localStorage.removeItem("litera.agent-book-width");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reader annotation chrome", () => {
  it("opens the overlay drawer and is exclusive with TOC", async () => {
    const screen = await openReader();
    expect(screen.getByTestId("reader-book-cell").contains(screen.getByTestId("reader-progress-bar"))).toBe(true);
    expect(screen.getByText("Chapter 1")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("标注"));
    expect(screen.getByText("添加书签")).toBeTruthy();
    expect(screen.getByText("还没有书签")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("目录"));
    expect(screen.queryByText("添加书签")).toBeNull();
    expect(screen.getByText("目录")).toBeTruthy();
  });

  it("saves a bookmark snapshot without writing BookRecord fields", async () => {
    const screen = await openReader();
    fireEvent.click(screen.getByLabelText("标注"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("添加书签"));
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_annotations",
        expect.objectContaining({
          bookId: "book1",
          data: expect.objectContaining({
            schemaVersion: 1,
            bookmarks: [
              expect.objectContaining({
                cfi: "epubcfi(/6/8!/4/2,/1:0,/1:80)",
                fraction: 0.42,
                label: "第三章",
              }),
            ],
            highlights: [],
          }),
        }),
      );
    });
    const payload = invokeMock.mock.calls.find((call) => call[0] === "save_annotations")?.[1] as {
      data: AnnotationsFile;
    };
    expect(payload.data).not.toHaveProperty("notes");
    expect(JSON.stringify(payload.data)).not.toContain("color");
  });

  it("does not overwrite annotations after a corrupt load", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_book_open_context") return Promise.resolve(openContext);
      if (cmd === "open_book_bytes") return Promise.resolve(new ArrayBuffer(8));
      if (cmd === "get_annotations") {
        return Promise.reject({ code: "StorageCorrupt", message: "bad json" });
      }
      if (cmd === "save_annotations") return Promise.resolve(undefined);
      if (cmd === "update_reading_state") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    const screen = await openReader();
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("bad json");
    });
    fireEvent.click(screen.getByLabelText("标注"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("添加书签"));
    });
    expect(invokeMock.mock.calls.some((call) => call[0] === "save_annotations")).toBe(
      false,
    );
  });

  it("expands chat then fills input when asking the agent", async () => {
    const screen = await openReader();
    expect(screen.getByLabelText("显示对话")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("fake-ask"));
    });
    await waitFor(() => {
      expect(screen.getByLabelText("隐藏对话")).toBeTruthy();
      expect(fillInput).toHaveBeenCalledWith("quoted", undefined);
    });
  });

  it("marks title and spacer as drag regions and closes via close()", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const screen = await openReader();
    const header = screen.container.querySelector("header");
    expect(header).toBeTruthy();
    expect(header!.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(header!.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(2);
    const toolbarNames = [
      "返回书库",
      "目录",
      "标注",
      "字体与主题",
      "切换到 Agent 模式",
      "显示对话",
      "关闭窗口",
    ];
    const headerButtons = [...header!.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label"),
    );
    expect(headerButtons.filter((name) => name && toolbarNames.includes(name))).toEqual(
      toolbarNames,
    );
    for (const name of toolbarNames) {
      expect(screen.getByRole("button", { name }).hasAttribute("data-tauri-drag-region")).toBe(
        false,
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "关闭窗口" }));
    expect(windowApi.close).toHaveBeenCalledTimes(1);
    expect(windowApi.destroy).not.toHaveBeenCalled();

    const spacer = header!.querySelectorAll("[data-tauri-drag-region]")[1];
    fireEvent.mouseDown(spacer, { buttons: 1, detail: 2 });
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("insets the macOS reader header and hides custom window buttons", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    );
    const screen = await openReader();
    const header = screen.container.querySelector("header");
    expect(header?.className).toContain("pl-[72px]");
    expect(screen.queryByRole("button", { name: "最小化" })).toBeNull();
    expect(screen.queryByRole("button", { name: "最大化" })).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭窗口" })).toBeNull();
    expect(screen.getByRole("button", { name: "返回书库" })).toBeTruthy();
  });

  it("saves a highlight from the selection action", async () => {
    const screen = await openReader();
    await act(async () => {
      fireEvent.click(screen.getByText("fake-highlight"));
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_annotations",
        expect.objectContaining({
          bookId: "book1",
          data: expect.objectContaining({
            highlights: [
              expect.objectContaining({
                cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)",
                excerpt: "selected sentence",
              }),
            ],
          }),
        }),
      );
    });
  });

  it("restores a previously saved chat panel width on expand", async () => {
    localStorage.setItem("litera.chat-panel-width", "35");
    const screen = await openReader();
    fireEvent.click(screen.getByText("fake-ask"));
    await waitFor(() => {
      expect(screen.getByTestId("reader-shell").style.gridTemplateColumns).toBe("1fr 35%");
    });
  });
});

describe("reader TOC drawer resize", () => {
  function mockDrawerRects(drawer: HTMLElement, container: HTMLElement) {
    vi.spyOn(drawer, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 224,
      bottom: 600,
      width: 224,
      height: 600,
      toJSON() {
        return {};
      },
    });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON() {
        return {};
      },
    });
  }

  async function openToc() {
    const screen = await openReader();
    fireEvent.click(screen.getByLabelText("目录"));
    const drawer = screen.container.querySelector(
      ".absolute.inset-y-0.left-0.z-30",
    ) as HTMLElement | null;
    const container = drawer?.parentElement as HTMLElement | null;
    expect(drawer).toBeTruthy();
    expect(container).toBeTruthy();
    mockDrawerRects(drawer!, container!);
    return { screen, drawer: drawer!, container: container! };
  }

  it("shows a drag handle on the drawer's right edge", async () => {
    const { screen } = await openToc();
    const handle = screen.getByRole("separator", { orientation: "vertical" });
    expect(handle.className).toContain("cursor-col-resize");
    expect(handle.className).toContain("hover:bg-primary/30");
  });

  it("starts at the default 224px width when nothing is saved", async () => {
    localStorage.removeItem("toc-sidebar-width");
    const { drawer } = await openToc();
    expect(drawer.style.width).toBe("224px");
  });

  it("restores a saved width on open", async () => {
    localStorage.setItem("toc-sidebar-width", "300");
    const { drawer } = await openToc();
    expect(drawer.style.width).toBe("300px");
  });

  it("drags to resize the drawer and persists the width", async () => {
    const { screen, drawer } = await openToc();
    const handle = screen.getByRole("separator", { orientation: "vertical" });
    fireEvent.pointerDown(handle, { clientX: 224, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 324, button: 0 });
    fireEvent.pointerUp(handle, { clientX: 324, button: 0 });
    expect(drawer.style.width).toBe("324px");
    expect(localStorage.getItem("toc-sidebar-width")).toBe("324");
  });

  it("clamps the width to the minimum while dragging", async () => {
    const { screen, drawer } = await openToc();
    const handle = screen.getByRole("separator", { orientation: "vertical" });
    fireEvent.pointerDown(handle, { clientX: 224, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 0, button: 0 });
    expect(drawer.style.width).toBe("160px");
  });

  it("clamps the width to the container on drag", async () => {
    const { screen, drawer } = await openToc();
    const handle = screen.getByRole("separator", { orientation: "vertical" });
    fireEvent.pointerDown(handle, { clientX: 224, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 2000, button: 0 });
    expect(drawer.style.width).toBe("800px");
  });

  it("keeps the width after closing and reopening the drawer", async () => {
    const { screen, drawer } = await openToc();
    const handle = screen.getByRole("separator", { orientation: "vertical" });
    fireEvent.pointerDown(handle, { clientX: 224, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 324, button: 0 });
    fireEvent.pointerUp(handle, { clientX: 324, button: 0 });
    expect(drawer.style.width).toBe("324px");

    fireEvent.click(screen.getByLabelText("目录"));
    expect(screen.queryByRole("separator", { orientation: "vertical" })).toBeNull();
    fireEvent.click(screen.getByLabelText("目录"));
    const reopened = screen.container.querySelector(
      ".absolute.inset-y-0.left-0.z-30",
    ) as HTMLElement | null;
    expect(reopened?.style.width).toBe("324px");
  });
});
