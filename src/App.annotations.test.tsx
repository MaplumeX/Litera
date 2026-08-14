// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationsFile, BookOpenContext } from "@/types/library";
import type { ReaderViewHandle } from "@/components/ReaderView";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async () => () => {},
    destroy: async () => {},
  }),
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

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  return {
    Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Separator: () => null,
    usePanelRef: () => ({
      current: {
        collapse: () => {},
        expand: () => {},
        isCollapsed: () => true,
        getSize: () => ({ asPercentage: 0 }),
        resize: () => {},
      },
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
    if (cmd === "close_book") return Promise.resolve(undefined);
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
  setupInvoke();
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
  vi.unstubAllGlobals();
});

describe("reader annotation chrome", () => {
  it("opens the overlay drawer and is exclusive with TOC", async () => {
    const screen = await openReader();
    expect(screen.getByText("Chapter 1 · 10%")).toBeTruthy();
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
});
