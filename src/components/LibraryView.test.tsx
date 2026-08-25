// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookRecord, ImportBookResult } from "@/types/library";

const invokeMock = vi.fn();
const dragDrop: {
  handler?: (event: { payload: { type: string; paths: string[] } }) => void;
} = {};
const windowApi = {
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  startDragging: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  convertFileSrc: (path: string) => path,
}));

Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: vi.fn(async (handler: (event: { payload: { type: string; paths: string[] } }) => void) => {
      dragDrop.handler = handler;
      return () => {
        dragDrop.handler = undefined;
      };
    }),
  }),
}));

vi.mock("@/lib/book-utils", () => ({
  extractEpubMetadata: vi.fn(async () => ({
    title: "Extracted Title",
    author: "Extracted Author",
    description: "A summary",
    publisher: "Pub",
    language: "en",
    series: "Saga · 1",
    coverBytes: null,
  })),
}));

import { LibraryView } from "@/components/LibraryView";
import { formatLibraryTimestamp } from "@/lib/library-shelf";
import { LIBRARY_SORT_KEY, LIBRARY_VIEW_KEY } from "@/lib/library-shelf-prefs";

const book: BookRecord = {
  id: "book-1",
  title: "Stored Title",
  author: "Author",
  coverPath: "",
  filePath: "/tmp/book.epub",
  importedAt: "2026-01-01T00:00:00+00:00",
};

function setupInvoke(handlers: Record<string, (args?: unknown) => unknown> = {}) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    if (cmd in handlers) {
      return Promise.resolve(handlers[cmd](args));
    }
    if (cmd === "list_books") {
      return Promise.resolve([book]);
    }
    return Promise.resolve(undefined);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  dragDrop.handler = undefined;
  windowApi.minimize.mockClear();
  windowApi.toggleMaximize.mockClear();
  windowApi.startDragging.mockClear();
  windowApi.close.mockClear();
  windowApi.destroy.mockClear();
  localStorage.removeItem(LIBRARY_SORT_KEY);
  localStorage.removeItem(LIBRARY_VIEW_KEY);
  setupInvoke();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LibraryView", () => {
  it("shows a duplicate banner with an open action and does not use alert", async () => {
    const onOpenBook = vi.fn();
    const alert = vi.spyOn(window, "alert");
    const duplicate: ImportBookResult = {
      status: "duplicate",
      bookId: "book-1",
      title: "Stored Title",
      name: "copy.epub",
    };
    setupInvoke({
      list_books: () => [book],
      import_book: () => [duplicate],
    });

    const { findByText, getByRole, queryByText } = render(
      <LibraryView onOpenBook={onOpenBook} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    getByRole("button", { name: "导入" }).click();

    expect(await findByText("《Stored Title》已在书库")).toBeTruthy();
    expect(queryByText("继续阅读")).toBeNull();
    getByRole("button", { name: "打开" }).click();
    expect(onOpenBook).toHaveBeenCalledWith("book-1");
    expect(alert).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_book_metadata")).toBe(false);
    alert.mockRestore();
  });

  it("asks before overwrite and discards the staged import on cancel", async () => {
    const overwrite: ImportBookResult = {
      status: "overwrite",
      bookId: "book-1",
      title: "Stored Title",
      importId: "imp-1",
      name: "book.epub",
    };
    setupInvoke({
      list_books: () => [book],
      import_book: () => [overwrite],
      discard_import: () => undefined,
    });

    const { findByText, getByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    getByRole("button", { name: "导入" }).click();

    expect(await findByText("覆盖「Stored Title」？")).toBeTruthy();
    expect(await findByText("将用新文件替换这本书。阅读进度、设置和对话会保留。")).toBeTruthy();
    getByRole("button", { name: "取消" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("discard_import", {
        bookId: "book-1",
        importId: "imp-1",
      });
    });
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_book_metadata")).toBe(false);
  });

  it("commits an overwrite after confirm", async () => {
    const overwrite: ImportBookResult = {
      status: "overwrite",
      bookId: "book-1",
      title: "Stored Title",
      importId: "imp-1",
      name: "book.epub",
    };
    setupInvoke({
      list_books: () => [book],
      import_book: () => [overwrite],
      read_import_bytes: () => new ArrayBuffer(8),
      save_book_metadata: () => book,
    });

    const { findByText, getByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    getByRole("button", { name: "导入" }).click();
    await findByText("覆盖「Stored Title」？");
    getByRole("button", { name: "覆盖" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_book_metadata",
        expect.objectContaining({
          bookId: "book-1",
          importId: "imp-1",
          title: "Extracted Title",
          description: "A summary",
          publisher: "Pub",
          language: "en",
          series: "Saga · 1",
        }),
      );
    });
  });

  it("shows import failures in a banner instead of alert", async () => {
    const alert = vi.spyOn(window, "alert");
    setupInvoke({
      list_books: () => [book],
      import_book: () => {
        throw { code: "StorageIo", message: "disk full" };
      },
    });

    const { findByText, getByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    getByRole("button", { name: "导入" }).click();

    expect(await findByText("导入失败：disk full")).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("ignores a cancelled file picker", async () => {
    setupInvoke({
      list_books: () => [book],
      import_book: () => {
        throw { code: "Cancelled", message: "No file selected" };
      },
    });

    const { findByText, getByRole, queryByText } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    getByRole("button", { name: "导入" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("import_book", undefined);
    });
    expect(queryByText(/导入失败/)).toBeNull();
  });

  it("enters select mode so cover clicks toggle instead of opening, and batch delete confirms once", async () => {
    const onOpenBook = vi.fn();
    const second: BookRecord = { ...book, id: "book-2", title: "Second Book" };
    setupInvoke({
      list_books: () => [book, second],
      delete_book: () => undefined,
    });

    const { findByText, getByRole, getByTitle } = render(
      <LibraryView onOpenBook={onOpenBook} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    getByRole("button", { name: "选择" }).click();
    expect(await findByText("已选 0")).toBeTruthy();

    getByTitle("Stored Title").click();
    getByTitle("Second Book").click();
    expect(onOpenBook).not.toHaveBeenCalled();
    expect(await findByText("已选 2")).toBeTruthy();

    getByRole("button", { name: "删除" }).click();
    expect(await findByText("删除 2 本书？")).toBeTruthy();
    expect(await findByText("将删除这些书的 AI 对话，此操作无法撤销。")).toBeTruthy();

    within(getByRole("alertdialog")).getByRole("button", { name: "取消" }).click();
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === "delete_book")).toBe(false);
    });

    getByRole("button", { name: "删除" }).click();
    await findByText("删除 2 本书？");
    within(getByRole("alertdialog")).getByRole("button", { name: "删除" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_book", { bookId: "book-1" });
      expect(invokeMock).toHaveBeenCalledWith("delete_book", { bookId: "book-2" });
    });
  });

  it("imports dropped files one path at a time so later files see committed hashes", async () => {
    const overwrite: ImportBookResult = {
      status: "overwrite",
      bookId: "book-1",
      title: "Stored Title",
      importId: "imp-1",
      name: "a.epub",
    };
    const duplicate: ImportBookResult = {
      status: "duplicate",
      bookId: "book-1",
      title: "Stored Title",
      name: "b.epub",
    };
    const seen: string[][] = [];
    setupInvoke({
      list_books: () => [book],
      import_paths: (args) => {
        const paths = (args as { paths: string[] }).paths;
        seen.push(paths);
        return paths[0] === "/tmp/a.epub" ? [overwrite] : [duplicate];
      },
      read_import_bytes: () => new ArrayBuffer(8),
      save_book_metadata: () => book,
    });

    const { findByText, getByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    await waitFor(() => expect(dragDrop.handler).toBeTruthy());

    await act(async () => {
      dragDrop.handler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/a.epub", "/tmp/notes.txt", "/tmp/b.epub"],
        },
      });
    });

    expect(await findByText("覆盖「Stored Title」？")).toBeTruthy();
    expect(seen).toEqual([["/tmp/a.epub"]]);
    within(getByRole("alertdialog")).getByRole("button", { name: "覆盖" }).click();

    expect(await findByText("《Stored Title》已在书库")).toBeTruthy();
    expect(seen).toEqual([["/tmp/a.epub"], ["/tmp/b.epub"]]);
  });

  it("confirms a single delete with the book title", async () => {
    setupInvoke({
      list_books: () => [book],
      delete_book: () => undefined,
    });

    const { findByText, getByRole, getByTitle } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    getByTitle("删除").click();

    expect(await findByText("删除「Stored Title」？")).toBeTruthy();
    expect(await findByText("将删除该书的 AI 对话，此操作无法撤销。")).toBeTruthy();
    getByRole("button", { name: "删除" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_book", { bookId: "book-1" });
    });
  });

  it("marks title and spacer as drag regions and keeps search and actions clickable", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const { findByText, container, getByPlaceholderText, getByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");

    const header = container.querySelector("header");
    expect(header).toBeTruthy();
    const title = getByRole("heading", { name: "Litera" });
    expect(title.className).toContain("text-sm");
    expect(title.className).toContain("font-medium");
    expect(title.className).not.toContain("text-lg");
    expect(title.className).not.toContain("font-semibold");
    expect(header!.hasAttribute("data-titlebar-drag")).toBe(false);
    expect(header!.querySelectorAll("[data-titlebar-drag]")).toHaveLength(2);
    expect(getByPlaceholderText("搜索书名或作者…").hasAttribute("data-titlebar-drag")).toBe(false);
    for (const name of ["导入", "选择", "设置", "最小化", "最大化", "关闭窗口"]) {
      expect(getByRole("button", { name }).hasAttribute("data-titlebar-drag")).toBe(false);
    }

    getByRole("button", { name: "关闭窗口" }).click();
    expect(windowApi.close).toHaveBeenCalledTimes(1);
    expect(windowApi.destroy).not.toHaveBeenCalled();

    const spacer = header!.querySelectorAll("[data-titlebar-drag]")[1];
    // Double-click detection is time/position based (Windows WebView2 reports
    // detail: 1 for every pointerdown once pointer capture is involved).
    fireEvent.pointerDown(spacer, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(spacer, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(spacer, { button: 0, detail: 1, pointerId: 1, clientX: 10, clientY: 10 });
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowApi.startDragging).not.toHaveBeenCalled();
  });

  it("insets the macOS library header and hides custom window buttons", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    );
    const { findByText, container, queryByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");

    const header = container.querySelector("header");
    expect(header?.className).toContain("pl-[72px]");
    expect(queryByRole("button", { name: "最小化" })).toBeNull();
    expect(queryByRole("button", { name: "最大化" })).toBeNull();
    expect(queryByRole("button", { name: "关闭窗口" })).toBeNull();
  });

  it("shows continue reading for opened books and hides it while searching", async () => {
    const opened: BookRecord = {
      ...book,
      lastOpenedAt: "2026-04-01T00:00:00+00:00",
    };
    setupInvoke({ list_books: () => [opened] });
    const onOpenBook = vi.fn();
    const { findByText, getByPlaceholderText, queryByText } = render(
      <LibraryView onOpenBook={onOpenBook} onOpenSettings={() => {}} />,
    );
    const heading = await findByText("继续阅读");
    const recents = heading.closest("section");
    expect(recents).toBeTruthy();
    const recentsGrid = (recents as HTMLElement).querySelector(".grid");
    const shelfGrid = (recents as HTMLElement).nextElementSibling;
    expect(recentsGrid?.className).toBe(shelfGrid?.className);
    expect(recentsGrid?.className).not.toContain("grid-cols-4");
    expect(within(recents as HTMLElement).queryByTitle("删除")).toBeNull();
    expect(within(recents as HTMLElement).queryByRole("button", { name: "更多操作" })).toBeNull();
    within(recents as HTMLElement).getByTitle("Stored Title").click();
    expect(onOpenBook).toHaveBeenCalledWith("book-1");

    fireEvent.change(getByPlaceholderText("搜索书名或作者…"), {
      target: { value: "Stored" },
    });
    expect(queryByText("继续阅读")).toBeNull();
  });

  it("keeps a right-click menu on continue reading cards", async () => {
    const opened: BookRecord = {
      ...book,
      lastOpenedAt: "2026-04-01T00:00:00+00:00",
    };
    setupInvoke({ list_books: () => [opened] });
    const onOpenBook = vi.fn();
    const { findByText, getByRole } = render(
      <LibraryView onOpenBook={onOpenBook} onOpenSettings={() => {}} />,
    );
    const heading = await findByText("继续阅读");
    const recents = heading.closest("section") as HTMLElement;
    fireEvent.contextMenu(within(recents).getByTitle("Stored Title"));
    (await waitFor(() => getByRole("menuitem", { name: "打开" }))).click();
    expect(onOpenBook).toHaveBeenCalledWith("book-1");
  });

  it("reorders the main list when sort changes without moving continue reading", async () => {
    const alpha: BookRecord = {
      ...book,
      id: "a",
      title: "Alpha",
      lastOpenedAt: "2026-01-01T00:00:00+00:00",
    };
    const zeta: BookRecord = {
      ...book,
      id: "z",
      title: "Zeta",
      lastOpenedAt: "2026-06-01T00:00:00+00:00",
    };
    setupInvoke({ list_books: () => [zeta, alpha] });
    const { findByText, getByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    const heading = await findByText("继续阅读");
    const recents = heading.closest("section") as HTMLElement;
    const main = recents.nextElementSibling as HTMLElement;
    expect(within(recents).getAllByTitle(/^(Alpha|Zeta)$/).map((el) => el.title)).toEqual([
      "Zeta",
      "Alpha",
    ]);

    getByRole("combobox", { name: "排序" }).click();
    (await waitFor(() => getByRole("option", { name: "书名" }))).click();
    await waitFor(() => {
      expect(localStorage.getItem(LIBRARY_SORT_KEY)).toBe("title");
      expect(within(main).getAllByTitle(/^(Alpha|Zeta)$/).map((el) => el.title)).toEqual([
        "Alpha",
        "Zeta",
      ]);
    });
    expect(within(recents).getAllByTitle(/^(Alpha|Zeta)$/).map((el) => el.title)).toEqual([
      "Zeta",
      "Alpha",
    ]);
  });

  it("switches to list view and persists the choice", async () => {
    const opened: BookRecord = {
      ...book,
      lastOpenedAt: "2026-04-01T12:00:00+00:00",
      lastFraction: 0.5,
    };
    setupInvoke({ list_books: () => [opened] });
    const { findAllByText, findByText, getByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findAllByText("Stored Title");
    getByRole("button", { name: "列表视图" }).click();
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe("list");
    expect(
      await findByText(formatLibraryTimestamp(opened.lastOpenedAt!, "zh-CN")),
    ).toBeTruthy();
    expect(getByRole("button", { name: "更多操作" })).toBeTruthy();
  });

  it("saves details without coverBytes when no new cover is chosen", async () => {
    const updated = { ...book, title: "New Title", author: "New Author" };
    setupInvoke({
      list_books: () => [book],
      update_book_metadata: () => updated,
    });
    const { findByText, getByRole, getByLabelText } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    (await waitFor(() => getByRole("menuitem", { name: "详情" }))).click();
    expect(await findByText("书籍详情")).toBeTruthy();

    fireEvent.change(getByLabelText("书名"), { target: { value: "New Title" } });
    fireEvent.change(getByLabelText("作者"), { target: { value: "New Author" } });
    getByRole("button", { name: "保存" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_book_metadata", {
        bookId: "book-1",
        title: "New Title",
        author: "New Author",
        description: "",
        publisher: "",
        language: "",
        series: "",
      });
    });
    expect(await findByText("New Title")).toBeTruthy();
  });

  it("saves extra details fields", async () => {
    const withExtra: BookRecord = {
      ...book,
      description: "Old blurb",
      publisher: "Old pub",
      language: "en",
      series: "Old series",
    };
    const updated = {
      ...withExtra,
      description: "New blurb",
      publisher: "New pub",
      language: "zh",
      series: "New series",
    };
    setupInvoke({
      list_books: () => [withExtra],
      update_book_metadata: () => updated,
    });
    const { findByText, getByRole, getByLabelText } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    (await waitFor(() => getByRole("menuitem", { name: "详情" }))).click();
    expect(await findByText("书籍详情")).toBeTruthy();

    fireEvent.change(getByLabelText("简介"), { target: { value: "New blurb" } });
    fireEvent.change(getByLabelText("出版社"), { target: { value: "New pub" } });
    fireEvent.change(getByLabelText("语言"), { target: { value: "zh" } });
    fireEvent.change(getByLabelText("系列"), { target: { value: "New series" } });
    getByRole("button", { name: "保存" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_book_metadata", {
        bookId: "book-1",
        title: "Stored Title",
        author: "Author",
        description: "New blurb",
        publisher: "New pub",
        language: "zh",
        series: "New series",
      });
    });
  });

  it("does not autofocus or select the title when opening details", async () => {
    const { findByText, getByRole, getByLabelText } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    (await waitFor(() => getByRole("menuitem", { name: "详情" }))).click();
    await findByText("书籍详情");
    const titleInput = getByLabelText("书名") as HTMLInputElement;
    expect(document.activeElement).not.toBe(titleInput);
    expect(
      titleInput.selectionStart === 0 && titleInput.selectionEnd === titleInput.value.length,
    ).toBe(false);
  });

  it("sends coverBytes and cache-busts the cover after a replace", async () => {
    URL.createObjectURL = vi.fn(() => "blob:cover-preview");
    URL.revokeObjectURL = vi.fn();
    const withCover: BookRecord = { ...book, coverPath: "/tmp/cover.jpg" };
    setupInvoke({
      list_books: () => [withCover],
      update_book_metadata: () => withCover,
    });
    const { findByText, getByRole, getByAltText, queryByText } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    (await waitFor(() => getByRole("menuitem", { name: "详情" }))).click();
    expect(await findByText("书籍详情")).toBeTruthy();

    const file = new File([new Uint8Array([1, 2, 3, 4])], "cover.png", {
      type: "image/png",
    });
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    getByRole("button", { name: "保存" }).click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_book_metadata",
        expect.objectContaining({
          bookId: "book-1",
          title: "Stored Title",
          author: "Author",
          coverBytes: [1, 2, 3, 4],
        }),
      );
      expect(queryByText("书籍详情")).toBeNull();
      expect(getByAltText("Stored Title").getAttribute("src")).toMatch(
        /\/tmp\/cover\.jpg\?v=\d+/,
      );
    });
  });

  it("does not save details when the title is cleared", async () => {
    const { findByText, getByRole, getByLabelText } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    (await waitFor(() => getByRole("menuitem", { name: "详情" }))).click();
    await findByText("书籍详情");
    fireEvent.change(getByLabelText("书名"), { target: { value: "   " } });
    expect(getByRole("button", { name: "保存" })).toHaveProperty("disabled", true);
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "update_book_metadata")).toBe(
      false,
    );
  });

  it("discards details edits on cancel", async () => {
    const { findByText, getByRole, getByLabelText, queryByText } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    (await waitFor(() => getByRole("menuitem", { name: "详情" }))).click();
    await findByText("书籍详情");
    fireEvent.change(getByLabelText("书名"), { target: { value: "Other" } });
    getByRole("button", { name: "取消" }).click();
    await waitFor(() => {
      expect(queryByText("书籍详情")).toBeNull();
    });
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "update_book_metadata")).toBe(
      false,
    );
    expect(await findByText("Stored Title")).toBeTruthy();
  });

  it("hides card menus in select mode", async () => {
    const { findByText, getByRole, queryByRole } = render(
      <LibraryView onOpenBook={() => {}} onOpenSettings={() => {}} />,
    );
    await findByText("Stored Title");
    expect(getByRole("button", { name: "更多操作" })).toBeTruthy();
    getByRole("button", { name: "选择" }).click();
    expect(await findByText("已选 0")).toBeTruthy();
    expect(queryByRole("button", { name: "更多操作" })).toBeNull();
  });
});
