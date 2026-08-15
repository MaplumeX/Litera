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
  close: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  convertFileSrc: (path: string) => path,
}));

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
    coverBytes: null,
  })),
}));

import { LibraryView } from "@/components/LibraryView";

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
  windowApi.close.mockClear();
  windowApi.destroy.mockClear();
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
    expect(header!.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(header!.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(2);
    expect(getByPlaceholderText("搜索书名或作者…").hasAttribute("data-tauri-drag-region")).toBe(
      false,
    );
    for (const name of ["导入", "选择", "设置", "最小化", "最大化", "关闭窗口"]) {
      expect(getByRole("button", { name }).hasAttribute("data-tauri-drag-region")).toBe(false);
    }

    getByRole("button", { name: "关闭窗口" }).click();
    expect(windowApi.close).toHaveBeenCalledTimes(1);
    expect(windowApi.destroy).not.toHaveBeenCalled();

    const spacer = header!.querySelectorAll("[data-tauri-drag-region]")[1];
    fireEvent.mouseDown(spacer, { buttons: 1, detail: 2 });
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
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
});
