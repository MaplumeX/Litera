// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderViewHandle } from "@/components/ReaderView";
import type { BookOpenContext, BookRecord, ImportBookResult } from "@/types/library";
import type { IncomingBook, PlatformEvent, PlatformEvents } from "@/lib/platform-bridge";
import { t } from "@/lib/i18n";
import { notifySyncActivity } from "@/lib/sync-activity";
import { MOBILE_SETTINGS_KEY } from "@/lib/mobile-settings";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  convertFileSrc: (path: string) => path,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.4.0"),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: () => Promise.resolve(),
}));

vi.mock("@/lib/book-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/book-utils")>()),
  extractEpubMetadata: vi.fn(async () => ({
    title: "Picked Book",
    author: "Someone",
    description: "",
    publisher: "",
    language: "",
    series: "",
    coverBytes: null,
  })),
}));

/** The platform event bridge: the only other process boundary. */
const bridge = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const api = {
    hasDocumentPicker: true,
    listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      return Object.assign(() => void set.delete(handler), { ready: Promise.resolve() });
    }),
    pickBooks: vi.fn(async (): Promise<unknown[]> => []),
    takePendingIncomingBooks: vi.fn(async (): Promise<unknown[]> => []),
    getInsets: vi.fn(async () => null),
    setImmersive: vi.fn(async (_enabled: boolean) => {}),
    setSystemBarsLight: vi.fn(async (_light: boolean) => {}),
    setKeepScreenOn: vi.fn(async (_enabled: boolean) => {}),
    setVolumeKeyPaging: vi.fn(async (_enabled: boolean) => {}),
    isNetworkMetered: vi.fn(async () => false),
    exitApp: vi.fn(async () => {}),
  };
  return { listeners, api };
});

vi.mock("@/lib/platform-bridge", () => ({ platformBridge: bridge.api }));

function emit<E extends PlatformEvent>(event: E, payload: PlatformEvents[E]) {
  for (const handler of bridge.listeners.get(event) ?? []) handler(payload);
}

const readerHandle = {
  prev: vi.fn(),
  next: vi.fn(),
  goToFraction: vi.fn(async () => {}),
  goToTocItem: vi.fn(),
  turnToChapter: vi.fn(async () => {}),
  getChapterTicks: () => [],
  previewLabelAt: () => undefined,
  goToCfi: vi.fn(async () => true),
  goToQuote: vi.fn(async () => true),
  setStyles: vi.fn(),
  setColumnCount: vi.fn(),
  setFlow: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  searchBook: vi.fn(() => null),
  clearSearch: vi.fn(),
  getToc: () => [],
  getXPointer: () => null,
  goToXPointer: vi.fn(async () => {}),
  getLocation: () => ({ cfi: "epubcfi(/6/8!/4/2/1:0)", fraction: 0.4, label: "第一章" }),
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
  dismissSelection: vi.fn(() => false),
  hasSelection: () => false,
} satisfies ReaderViewHandle;

vi.mock("@/components/ReaderView", async () => {
  const React = await import("react");
  return {
    ReaderView: React.forwardRef(function MockReader(
      props: {
        onMiddleTap?: () => void;
        onSelectionCapture?: (capture: { text: string; chapterHref?: string }) => void;
      },
      ref: React.ForwardedRef<ReaderViewHandle>,
    ) {
      React.useImperativeHandle(ref, () => readerHandle);
      return (
        <div data-testid="reader-view">
          <button type="button" onClick={() => props.onMiddleTap?.()}>
            middle-tap
          </button>
          <button
            type="button"
            onClick={() => props.onSelectionCapture?.({ text: "a passage", chapterHref: "ch1" })}
          >
            ask-about-selection
          </button>
        </div>
      );
    }),
  };
});

const fillInput = vi.fn();
vi.mock("@/components/chat/ChatPanel", async () => {
  const React = await import("react");
  return {
    ChatPanel: React.forwardRef(function MockChat(_props, ref) {
      React.useImperativeHandle(ref, () => ({ fillInput }));
      return <div data-testid="chat-panel" />;
    }),
  };
});

import MobileApp from "./MobileApp";

function book(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: "book1",
    title: "第一本书",
    author: "作者",
    coverPath: "",
    filePath: "/books/book1/book.epub",
    importedAt: "2026-01-01T00:00:00Z",
    readingStatus: "reading",
    cached: true,
    ...overrides,
  };
}

let books: BookRecord[];
let openContext: BookOpenContext;
let syncEnabled: boolean;
let downloadSize: number | null;
let incomingResult: ImportBookResult | undefined;

function setupInvoke() {
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "list_books":
        return Promise.resolve(books);
      case "list_trashed_books":
      case "list_system_fonts":
        return Promise.resolve([]);
      case "get_book_open_context":
        return Promise.resolve({ ...openContext });
      case "open_book_bytes":
      case "read_import_bytes":
        return Promise.resolve(new ArrayBuffer(8));
      case "get_annotations":
        return Promise.resolve({ schemaVersion: 1, bookmarks: [], highlights: [] });
      case "get_sync_config":
        return Promise.resolve({ enabled: syncEnabled });
      case "sync_export_local_manifest":
        return Promise.resolve({ schemaVersion: 1, books: {}, tombstones: [], preferences: null, provider: null });
      case "sync_download_manifest":
        return Promise.resolve({
          etag: "e1",
          manifest: { schemaVersion: 1, books: {}, tombstones: [], preferences: null, provider: null },
        });
      case "sync_book_download_size":
        return Promise.resolve(downloadSize);
      case "import_incoming_book":
        return Promise.resolve(incomingResult);
      default:
        return Promise.resolve(undefined);
    }
  });
}

function calls(cmd: string) {
  return invokeMock.mock.calls.filter(([name]) => name === cmd);
}

async function renderApp() {
  const screen = render(<MobileApp />);
  await waitFor(() => expect(screen.getAllByTitle("第一本书").length).toBeGreaterThan(0));
  return screen;
}

async function openBook(screen: Awaited<ReturnType<typeof renderApp>>) {
  const shelf = screen.container.querySelector('[data-shelf="main"]') as HTMLElement;
  await act(async () => {
    fireEvent.click(within(shelf).getAllByTitle("第一本书")[0]);
  });
  await waitFor(() => expect(screen.getByTestId("reader-view")).toBeTruthy());
}

async function back() {
  await act(async () => {
    emit("back", {});
  });
}

beforeEach(() => {
  books = [book()];
  openContext = {
    name: "book.epub",
    title: "第一本书",
    bookId: "book1",
    contentVersion: "v1",
    lastFraction: 0.2,
    readingStatus: "reading",
  };
  syncEnabled = false;
  downloadSize = null;
  incomingResult = undefined;
  invokeMock.mockReset();
  setupInvoke();
  fillInput.mockClear();
  for (const fn of Object.values(bridge.api)) {
    if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
  }
  bridge.api.isNetworkMetered.mockImplementation(async () => false);
  bridge.api.pickBooks.mockImplementation(async () => []);
  bridge.api.takePendingIncomingBooks.mockImplementation(async () => []);
  readerHandle.dismissSelection.mockImplementation(() => false);
  readerHandle.next.mockClear();
  readerHandle.prev.mockClear();
  localStorage.clear();
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

describe("MobileApp — navigation", () => {
  it("opens a Book from the Library and Back returns to the Library, then leaves the app", async () => {
    const screen = await renderApp();
    await openBook(screen);
    expect(screen.queryByRole("button", { name: t("mobile.searchLibrary") })).toBeNull();

    await back();
    await waitFor(() => expect(screen.queryByTestId("reader-view")).toBeNull());
    expect(screen.getByRole("button", { name: t("mobile.searchLibrary") })).toBeTruthy();
    expect(bridge.api.exitApp).not.toHaveBeenCalled();

    await back();
    expect(bridge.api.exitApp).toHaveBeenCalledOnce();
  });

  it("closes the Library search on Back before leaving the app", async () => {
    books = [book(), book({ id: "book2", title: "另一本书" })];
    const screen = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: t("mobile.searchLibrary") }));
    fireEvent.change(screen.getByRole("searchbox", { name: t("mobile.searchLibrary") }), {
      target: { value: "另一" },
    });
    await waitFor(() => expect(screen.queryAllByTitle("第一本书")).toHaveLength(0));

    await back();
    expect(screen.queryByRole("searchbox")).toBeNull();
    await waitFor(() => expect(screen.getAllByTitle("第一本书").length).toBeGreaterThan(0));
    expect(bridge.api.exitApp).not.toHaveBeenCalled();

    await back();
    expect(bridge.api.exitApp).toHaveBeenCalledOnce();
  });

  it("closes the innermost layer first: dialog, selection, assistant sheet, toolbars, Reader", async () => {
    const screen = await renderApp();
    await openBook(screen);

    // Toolbars, then the assistant sheet, then the contents panel on top.
    fireEvent.click(screen.getByText("middle-tap"));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.assistant") }));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.toc") }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: t("mobile.toc") })).toBeTruthy());
    const sheet = () => screen.container.querySelector("[data-snap]") as HTMLElement;
    expect(sheet().dataset.snap).toBe("half");

    await back();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: t("mobile.toc") })).toBeNull());
    expect(sheet().dataset.snap).toBe("half");

    readerHandle.dismissSelection.mockImplementationOnce(() => true);
    await back();
    expect(readerHandle.dismissSelection).toHaveBeenCalled();
    expect(sheet().dataset.snap).toBe("half");

    await back();
    expect(sheet().dataset.snap).toBe("collapsed");
    expect(screen.getByRole("button", { name: t("reader.backToLibrary") })).toBeTruthy();

    await back();
    expect(screen.queryByRole("button", { name: t("reader.backToLibrary") })).toBeNull();
    expect(screen.getByTestId("reader-view")).toBeTruthy();

    await back();
    await waitFor(() => expect(screen.queryByTestId("reader-view")).toBeNull());

    await back();
    expect(bridge.api.exitApp).toHaveBeenCalledOnce();
  });

  it("toggles the toolbars on a middle tap, and is immersive while they are hidden", async () => {
    const screen = await renderApp();
    expect(bridge.api.setImmersive).toHaveBeenLastCalledWith(false);
    await openBook(screen);
    expect(bridge.api.setImmersive).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("button", { name: t("reader.backToLibrary") })).toBeNull();

    fireEvent.click(screen.getByText("middle-tap"));
    expect(screen.getByRole("button", { name: t("reader.backToLibrary") })).toBeTruthy();
    expect(bridge.api.setImmersive).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByText("middle-tap"));
    expect(screen.queryByRole("button", { name: t("reader.backToLibrary") })).toBeNull();
    expect(bridge.api.setImmersive).toHaveBeenLastCalledWith(true);
  });
});

describe("MobileApp — system bars", () => {
  const inset = (name: string) => document.documentElement.style.getPropertyValue(name);
  const insets = { top: 24, bottom: 16, imeBottom: 0, left: 0, right: 0, cutoutTop: 24, cutoutBottom: 0 };

  it("keeps the page clear of the system bars: asks for the insets, then follows them", async () => {
    bridge.api.getInsets.mockImplementationOnce(async () => insets as never);
    await renderApp();
    await waitFor(() => expect(inset("--android-inset-top")).toBe("24px"));
    expect(inset("--android-inset-bottom")).toBe("16px");
    expect(inset("--android-cutout-top")).toBe("24px");

    act(() => emit("insets", { ...insets, top: 0, bottom: 0 }));
    expect(inset("--android-inset-top")).toBe("0px");
    expect(inset("--android-cutout-top")).toBe("24px");
  });

  it("keeps keyboard occlusion separate from the navigation bar, including after dismissal", async () => {
    await renderApp();
    act(() => emit("insets", { ...insets, imeBottom: 320 }));
    expect(inset("--android-inset-bottom")).toBe("16px");
    expect(inset("--android-ime-bottom")).toBe("320px");

    act(() => emit("insets", insets));
    expect(inset("--android-inset-bottom")).toBe("16px");
    expect(inset("--android-ime-bottom")).toBe("0px");
  });

  it("matches the status bar icons to the app's theme", async () => {
    const screen = await renderApp();
    expect(bridge.api.setSystemBarsLight).toHaveBeenLastCalledWith(true);
    await openBook(screen);

    fireEvent.click(screen.getByText("middle-tap"));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.night") }));
    await waitFor(() => expect(bridge.api.setSystemBarsLight).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole("button", { name: t("mobile.day") })).toBeTruthy();
  });
});

describe("MobileApp — reading settings", () => {
  it("changes the text size from the reader's settings sheet", async () => {
    const screen = await renderApp();
    await openBook(screen);
    fireEvent.click(screen.getByText("middle-tap"));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.readingSettings") }));
    const sheet = await screen.findByRole("dialog", { name: t("mobile.readingSettings") });

    readerHandle.setStyles.mockClear();
    fireEvent.click(
      within(sheet).getByRole("button", {
        name: t("settings.stepper.increase", { label: t("mobile.textSize") }),
      }),
    );
    await waitFor(() =>
      expect(readerHandle.setStyles).toHaveBeenLastCalledWith(expect.stringContaining("font-size: 17px")),
    );
  });

  it("picks the typeface from a list behind the font row, then returns to the settings", async () => {
    const screen = await renderApp();
    await openBook(screen);
    fireEvent.click(screen.getByText("middle-tap"));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.readingSettings") }));
    const sheet = await screen.findByRole("dialog", { name: t("mobile.readingSettings") });

    fireEvent.click(within(sheet).getByRole("button", { name: new RegExp(`^${t("settings.font")}:`) }));
    readerHandle.setStyles.mockClear();
    fireEvent.click(within(sheet).getByRole("radio", { name: t("settings.font.sans") }));

    await waitFor(() =>
      expect(readerHandle.setStyles).toHaveBeenLastCalledWith(expect.stringContaining("sans-serif")),
    );
    expect(
      within(sheet).getByRole("button", { name: `${t("settings.font")}: ${t("settings.font.sans")}` }),
    ).toBeTruthy();
  });

  it("opens Settings on the typography page from “More settings”, and Back returns to the list", async () => {
    const screen = await renderApp();
    await openBook(screen);
    fireEvent.click(screen.getByText("middle-tap"));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.readingSettings") }));
    fireEvent.click(await screen.findByRole("button", { name: t("mobile.moreSettings") }));

    expect(await screen.findByRole("dialog", { name: t("settings.typography") })).toBeTruthy();
    await back();
    expect(await screen.findByRole("dialog", { name: t("settings.title") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("mobile.device") })).toBeTruthy();
    await back();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: t("settings.title") })).toBeNull());
  });
});

describe("MobileApp — assistant sheet", () => {
  // A collapsed sheet is hidden, which leaves it without an accessible name.
  const sheet = (screen: Awaited<ReturnType<typeof renderApp>>) =>
    screen.container.querySelector("[data-snap]") as HTMLElement;

  it("opens at half height with the selected passage when asked about a selection", async () => {
    const screen = await renderApp();
    await openBook(screen);
    expect(sheet(screen).dataset.snap).toBe("collapsed");

    fireEvent.click(screen.getByText("ask-about-selection"));

    expect(sheet(screen).dataset.snap).toBe("half");
    expect(fillInput).toHaveBeenCalledWith("a passage", "ch1");
  });

  it("remembers full screen as the Book's Agent mode and reopens the Book that way", async () => {
    const screen = await renderApp();
    await openBook(screen);
    fireEvent.click(screen.getByText("middle-tap"));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.assistant") }));
    fireEvent.click(screen.getByRole("button", { name: t("mobile.sheetFull") }));
    expect(sheet(screen).dataset.snap).toBe("full");

    await waitFor(() =>
      expect(calls("update_reading_state").map(([, args]) => args)).toContainEqual({
        bookId: "book1",
        lastReaderMode: "agent",
      }),
    );

    await back(); // the sheet
    await back(); // the toolbars
    await back(); // the Reader
    await waitFor(() => expect(screen.queryByTestId("reader-view")).toBeNull());

    openContext.lastReaderMode = "agent";
    await openBook(screen);
    expect(sheet(screen).dataset.snap).toBe("full");
  });
});

describe("MobileApp — importing", () => {
  const picked: IncomingBook = { name: "Picked.epub", path: "/cache/incoming-books/a.epub" };

  it("imports what the system picker returns through the path-less import", async () => {
    bridge.api.pickBooks.mockImplementation(async () => [picked]);
    incomingResult = { status: "new", bookId: "book2", title: "Picked.epub", importId: "imp-1", name: "Picked.epub" };
    const screen = await renderApp();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("library.importBooks") }));
    });

    await waitFor(() => expect(calls("save_book_metadata")).toHaveLength(1));
    expect(bridge.api.pickBooks).toHaveBeenCalledOnce();
    expect(calls("import_incoming_book")[0][1]).toEqual({
      file: { path: picked.path, name: "Picked.epub" },
    });
    expect(calls("import_book")).toHaveLength(0);
    expect(calls("save_book_metadata")[0][1]).toMatchObject({ bookId: "book2", importId: "imp-1" });
  });

  it("says so when a picked book is already in the Library", async () => {
    bridge.api.pickBooks.mockImplementation(async () => [picked]);
    incomingResult = { status: "duplicate", bookId: "book1", title: "第一本书", name: "Picked.epub" };
    const screen = await renderApp();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("library.importBooks") }));
    });

    await waitFor(() =>
      expect(screen.getByText(t("library.alreadyInLibrary", { title: "第一本书" }))).toBeTruthy(),
    );
    expect(calls("save_book_metadata")).toHaveLength(0);
  });

  it("reports a file the platform couldn't read", async () => {
    bridge.api.pickBooks.mockImplementation(async () => [{ name: "Broken.epub", error: "Permission denied" }]);
    const screen = await renderApp();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("library.importBooks") }));
    });

    await waitFor(() => expect(screen.getByText(/Broken\.epub: Permission denied/)).toBeTruthy());
    expect(calls("import_incoming_book")).toHaveLength(0);
  });

  it("imports and opens a book shared or opened with Litera while running", async () => {
    incomingResult = { status: "duplicate", bookId: "book1", title: "第一本书", name: "Shared.epub" };
    const screen = await renderApp();

    await act(async () => {
      emit("incomingBooks", { books: [{ name: "Shared.epub", path: "/cache/incoming-books/s.epub" }] });
    });

    await waitFor(() => expect(screen.getByTestId("reader-view")).toBeTruthy());
    expect(calls("import_incoming_book")[0][1]).toEqual({
      file: { path: "/cache/incoming-books/s.epub", name: "Shared.epub" },
    });
  });

  it("imports a book that launched the app (cold start)", async () => {
    bridge.api.takePendingIncomingBooks.mockImplementation(async () => [
      { name: "Cold.epub", path: "/cache/incoming-books/c.epub" },
    ]);
    incomingResult = { status: "duplicate", bookId: "book1", title: "第一本书", name: "Cold.epub" };
    const screen = render(<MobileApp />);

    await waitFor(() => expect(screen.getByTestId("reader-view")).toBeTruthy());
    expect(calls("import_incoming_book")[0][1]).toEqual({
      file: { path: "/cache/incoming-books/c.epub", name: "Cold.epub" },
    });
  });
});

describe("MobileApp — Sync lifecycle", () => {
  it("pulls and merges when the app returns to the foreground", async () => {
    syncEnabled = true;
    await renderApp();
    await waitFor(() => expect(calls("sync_export_local_manifest")).toHaveLength(1)); // startup
    await waitFor(() => expect(calls("sync_note_result")).toHaveLength(1));

    await act(async () => {
      emit("lifecycle", { state: "foreground" });
    });

    await waitFor(() => expect(calls("sync_export_local_manifest")).toHaveLength(2));
  });

  it("pushes pending changes, without book files, when the app goes to the background", async () => {
    syncEnabled = true;
    await renderApp();
    await waitFor(() => expect(calls("sync_note_result")).toHaveLength(1));
    invokeMock.mockClear();
    notifySyncActivity();

    await act(async () => {
      emit("lifecycle", { state: "background" });
    });

    await waitFor(() => expect(calls("sync_upload_manifest")).toHaveLength(1));
    expect(calls("sync_upload_book_files")).toHaveLength(0);
  });

  it("uploads book files on an unmetered network", async () => {
    syncEnabled = true;
    await renderApp();
    await waitFor(() => expect(calls("sync_note_result")).toHaveLength(1));
    expect(calls("sync_upload_book_files")).toHaveLength(1);
  });

  it("syncs without book files on a metered network while Wi-Fi only is on", async () => {
    syncEnabled = true;
    bridge.api.isNetworkMetered.mockImplementation(async () => true);
    await renderApp();
    await waitFor(() => expect(calls("sync_note_result")).toHaveLength(1));
    expect(calls("sync_upload_manifest")).toHaveLength(1);
    expect(calls("sync_upload_book_files")).toHaveLength(0);
  });

  it("asks before downloading a not-cached Book on mobile data, and declining keeps it not cached", async () => {
    books = [book({ cached: false })];
    bridge.api.isNetworkMetered.mockImplementation(async () => true);
    downloadSize = 3 * 1024 * 1024;
    const screen = await renderApp();

    const shelf = screen.container.querySelector('[data-shelf="main"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(shelf).getAllByTitle("第一本书")[0]);
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("mobile.downloadTitle", { title: "第一本书" }))).toBeTruthy();
    expect(within(dialog).getByText(/3(\.0)? MB/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("sync_download_book_file")).toHaveLength(0);
    expect(screen.queryByTestId("reader-view")).toBeNull();
  });

  it("opens the copy on the phone and leaves a newer file for Wi-Fi", async () => {
    bridge.api.isNetworkMetered.mockImplementation(async () => true);
    downloadSize = 3 * 1024 * 1024; // a newer revision exists remotely
    const screen = await renderApp();

    await openBook(screen);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("sync_download_book_file")).toHaveLength(0);
  });

  it("downloads without asking when Wi-Fi only is off", async () => {
    books = [book({ cached: false })];
    localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify({ wifiOnlyBookFiles: false }));
    bridge.api.isNetworkMetered.mockImplementation(async () => true);
    downloadSize = 3 * 1024 * 1024;
    const screen = await renderApp();

    await openBook(screen);

    expect(calls("sync_download_book_file")).toHaveLength(1);
    expect(calls("sync_book_download_size")).toHaveLength(0);
  });
});

describe("MobileApp — volume keys and settings", () => {
  it("turns pages with the volume keys only when enabled, and only in the Reader", async () => {
    localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify({ volumeKeyPaging: true }));
    const screen = await renderApp();
    expect(bridge.api.setVolumeKeyPaging).toHaveBeenLastCalledWith(false);

    act(() => emit("volumeKey", { direction: "down" }));
    expect(readerHandle.next).not.toHaveBeenCalled();

    await openBook(screen);
    expect(bridge.api.setVolumeKeyPaging).toHaveBeenLastCalledWith(true);
    act(() => emit("volumeKey", { direction: "down" }));
    act(() => emit("volumeKey", { direction: "up" }));
    expect(readerHandle.next).toHaveBeenCalledOnce();
    expect(readerHandle.prev).toHaveBeenCalledOnce();
  });

  it("leaves the volume keys alone while the setting is off", async () => {
    const screen = await renderApp();
    await openBook(screen);

    expect(bridge.api.setVolumeKeyPaging).toHaveBeenLastCalledWith(false);
    act(() => emit("volumeKey", { direction: "down" }));
    expect(readerHandle.next).not.toHaveBeenCalled();
  });

  it("offers the phone's own settings and none of the desktop window controls", async () => {
    const screen = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: t("mobile.menu") }));
    fireEvent.click(await screen.findByRole("button", { name: t("library.settings") }));
    fireEvent.click(await screen.findByRole("button", { name: t("mobile.device") }));

    const volume = screen.getByRole("switch", { name: t("mobile.volumeKeys") });
    const keepOn = screen.getByRole("switch", { name: t("mobile.keepScreenOn") });
    const wifi = screen.getByRole("switch", { name: new RegExp(t("mobile.wifiOnly")) });
    expect([volume, keepOn, wifi].map((s) => s.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(screen.queryByRole("button", { name: t("window.minimize") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("window.close") })).toBeNull();

    fireEvent.click(keepOn);
    expect(JSON.parse(localStorage.getItem(MOBILE_SETTINGS_KEY) ?? "{}")).toMatchObject({
      keepScreenOn: true,
    });
  });

  it("keeps the screen on in the Reader when asked to", async () => {
    localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify({ keepScreenOn: true }));
    const screen = await renderApp();
    expect(bridge.api.setKeepScreenOn).toHaveBeenLastCalledWith(false);

    await openBook(screen);
    expect(bridge.api.setKeepScreenOn).toHaveBeenLastCalledWith(true);
  });
});
