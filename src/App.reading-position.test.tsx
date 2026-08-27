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
  startDragging: vi.fn(async () => {}),
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

const readerHandle: ReaderViewHandle = {
  prev: vi.fn(),
  next: vi.fn(),
  goToFraction: vi.fn(async () => {}),
  goToTocItem: vi.fn(),
  getSectionFractions: () => [],
  previewLabelAt: () => undefined,
  goToCfi: vi.fn(async () => true),
  setStyles: vi.fn(),
  setColumnCount: vi.fn(),
  getToc: () => [],
  getLocation: () => ({
    cfi: "epubcfi(/6/8!/4/2,/1:0,/1:80)",
    fraction: 0.42,
    label: "第三章",
  }),
  getSelectionCfi: () => null,
  addHighlight: vi.fn(),
  removeHighlight: vi.fn(),
  initTts: vi.fn(async () => true),
  ttsSpeakOrigin: vi.fn(() => undefined),
  ttsNext: vi.fn(() => undefined),
  ttsResume: vi.fn(() => undefined),
  ttsSetMark: vi.fn(),
  clearTtsHighlight: vi.fn(),
  advanceTtsSection: vi.fn(async () => undefined),
};

vi.mock("@/components/ReaderView", async () => {
  const React = await import("react");
  return {
    ReaderView: React.forwardRef(function MockReader(
      props: {
        onRelocate?: (
          index: number,
          fraction: number,
          label?: string,
          chapterHref?: string,
          cfi?: string,
        ) => void;
        initialFraction?: number;
        initialCfi?: string;
      },
      ref: React.ForwardedRef<ReaderViewHandle>,
    ) {
      React.useImperativeHandle(ref, () => readerHandle);
      return (
        <div data-testid="reader-view">
          <span data-testid="initial-cfi">{props.initialCfi ?? ""}</span>
          <span data-testid="initial-fraction">{String(props.initialFraction ?? "")}</span>
          <button
            type="button"
            onClick={() =>
              props.onRelocate?.(
                3,
                0.55,
                "第三章",
                "ch3",
                "epubcfi(/6/10!/4/2/1:0)",
              )
            }
          >
            fake-relocate
          </button>
          <button
            type="button"
            onClick={() => props.onRelocate?.(1, 0.2, "第一章", "ch1")}
          >
            fake-relocate-no-cfi
          </button>
        </div>
      );
    }),
  };
});

vi.mock("@/components/chat/ChatPanel", async () => {
  const React = await import("react");
  return {
    ChatPanel: React.forwardRef(function MockChat() {
      return <div data-testid="chat-panel" />;
    }),
  };
});

import App from "./App";

const SAVED_CFI = "epubcfi(/6/4!/4/2/1:0)";

const openContext: BookOpenContext = {
  name: "book.epub",
  title: "测试书",
  bookId: "book1",
  contentVersion: "v1",
  lastFraction: 0.1,
  lastCfi: SAVED_CFI,
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

function readingStateCalls() {
  return invokeMock.mock.calls.filter((call) => call[0] === "update_reading_state");
}

beforeEach(() => {
  invokeMock.mockReset();
  windowApi.onCloseRequested.mockClear();
  openContext.lastCfi = SAVED_CFI;
  openContext.lastFraction = 0.1;
  setupInvoke();
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
  vi.unstubAllGlobals();
});

describe("reading position restore", () => {
  it("passes lastCfi into ReaderView as initialCfi on open", async () => {
    const screen = await openReader();
    expect(screen.getByTestId("initial-cfi").textContent).toBe(SAVED_CFI);
    expect(screen.getByTestId("initial-fraction").textContent).toBe("0.1");
  });

  it("persists lastFraction and lastCfi together on relocate without settings", async () => {
    const screen = await openReader();
    fireEvent.click(screen.getByText("fake-relocate"));
    await waitFor(
      () => {
        expect(invokeMock).toHaveBeenCalledWith(
          "update_reading_state",
          expect.objectContaining({
            bookId: "book1",
            lastFraction: 0.55,
            lastCfi: "epubcfi(/6/10!/4/2/1:0)",
          }),
        );
      },
      { timeout: 1500 },
    );
    const args = readingStateCalls().at(-1)?.[1] as {
      settings?: unknown;
      lastReaderMode?: unknown;
      lastLayout?: unknown;
    };
    expect(args.settings).toBeUndefined();
    expect(args.lastReaderMode).toBeUndefined();
    expect(args.lastLayout).toBeUndefined();
  });

  it("omits lastCfi when relocate has no locator", async () => {
    const screen = await openReader();
    fireEvent.click(screen.getByText("fake-relocate-no-cfi"));
    await waitFor(
      () => {
        expect(invokeMock).toHaveBeenCalledWith(
          "update_reading_state",
          expect.objectContaining({
            bookId: "book1",
            lastFraction: 0.2,
          }),
        );
      },
      { timeout: 1500 },
    );
    const args = readingStateCalls().at(-1)?.[1] as { lastCfi?: string };
    expect(args.lastCfi).toBeUndefined();
  });

  it("does not write lastCfi into currentBook on relocate", async () => {
    const screen = await openReader();
    expect(screen.getByTestId("initial-cfi").textContent).toBe(SAVED_CFI);
    fireEvent.click(screen.getByText("fake-relocate"));
    await waitFor(
      () => {
        expect(invokeMock).toHaveBeenCalledWith(
          "update_reading_state",
          expect.objectContaining({ lastCfi: "epubcfi(/6/10!/4/2/1:0)" }),
        );
      },
      { timeout: 1500 },
    );
    expect(screen.getByTestId("initial-cfi").textContent).toBe(SAVED_CFI);
    expect(screen.getByTestId("initial-fraction").textContent).toBe("0.1");
  });
});
