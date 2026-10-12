// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookCard, BookListRow } from "@/components/BookCard";
import type { BookRecord } from "@/types/library";
import { setLocale } from "@/lib/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

afterEach(() => {
  cleanup();
});

const book: BookRecord = {
  id: "abc",
  title: "Test Book",
  author: "Author",
  coverPath: "",
  filePath: "/tmp/book.epub",
  importedAt: "2026-01-01T00:00:00+00:00",
};

function renderCard(overrides: Partial<ComponentProps<typeof BookCard>> = {}) {
  return render(
    <BookCard
      book={book}
      onOpen={() => {}}
      onDelete={() => {}}
      onDetails={() => {}}
      {...overrides}
    />,
  );
}

describe("BookCard", () => {
  it("shows progress only when lastFraction is set", () => {
    const { rerender, queryByText, getByText } = renderCard();
    expect(queryByText("0%")).toBeNull();
    expect(queryByText("42%")).toBeNull();

    rerender(
      <BookCard
        book={{ ...book, lastFraction: 0 }}
        onOpen={() => {}}
        onDelete={() => {}}
        onDetails={() => {}}
      />,
    );
    expect(getByText("0%")).toBeTruthy();

    rerender(
      <BookCard
        book={{ ...book, lastFraction: 0.42 }}
        onOpen={() => {}}
        onDelete={() => {}}
        onDetails={() => {}}
      />,
    );
    expect(getByText("42%")).toBeTruthy();
  });

  it("does not open when openDisabled", () => {
    const onOpen = vi.fn();
    const { getByTitle } = renderCard({ onOpen, openDisabled: true });

    getByTitle("Test Book").click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("toggles selection in select mode instead of opening", () => {
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    const { getByTitle } = renderCard({
      onOpen,
      selectMode: true,
      onToggleSelect,
    });

    getByTitle("Test Book").click();
    expect(onToggleSelect).toHaveBeenCalledWith("abc");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("requests delete from the menu without using window.confirm", async () => {
    const onDelete = vi.fn();
    const confirm = vi.spyOn(window, "confirm");
    const { getByRole, queryByTitle } = renderCard({ onDelete });

    // No hover ✕: Delete is reached through the menu, last and destructive.
    expect(queryByTitle("删除")).toBeNull();
    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    const items = await waitFor(() => {
      const found = Array.from(document.querySelectorAll('[role="menuitem"]'));
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    const remove = items[items.length - 1] as HTMLElement;
    expect(remove.textContent).toBe("删除…");
    remove.click();
    expect(onDelete).toHaveBeenCalledWith("abc");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("offers star and select in the menu when the host supports them", async () => {
    const onToggleStar = vi.fn();
    const onEnterSelect = vi.fn();
    const { getByTitle, getByRole } = renderCard({
      book: { ...book, starred: true },
      onToggleStar,
      onEnterSelect,
    });

    fireEvent.contextMenu(getByTitle("Test Book"));
    (await waitFor(() => getByRole("menuitem", { name: "取消星标" }))).click();
    expect(onToggleStar).toHaveBeenCalledWith({ ...book, starred: true });

    fireEvent.contextMenu(getByTitle("Test Book"));
    (await waitFor(() => getByRole("menuitem", { name: "选择" }))).click();
    expect(onEnterSelect).toHaveBeenCalledWith("abc");
  });

  it("sets a reading status from the menu's submenu", async () => {
    const onChangeStatus = vi.fn();
    const { getByTitle, getByRole } = renderCard({ onChangeStatus });

    fireEvent.contextMenu(getByTitle("Test Book"));
    const trigger = await waitFor(() => getByRole("menuitem", { name: "阅读状态" }));
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    (await waitFor(() => getByRole("menuitem", { name: "在读" }))).click();
    expect(onChangeStatus).toHaveBeenCalledWith(book, "reading");
  });

  it("leaves curation out of the menu when the host does not support it", async () => {
    const { getByTitle, getByRole, queryByRole } = renderCard();
    fireEvent.contextMenu(getByTitle("Test Book"));
    await waitFor(() => getByRole("menuitem", { name: "打开" }));
    expect(queryByRole("menuitem", { name: "阅读状态" })).toBeNull();
    expect(queryByRole("menuitem", { name: "加星标" })).toBeNull();
    expect(queryByRole("menuitem", { name: "选择" })).toBeNull();
  });

  it("shows a more-actions menu that can open details", async () => {
    const onDetails = vi.fn();
    const onOpen = vi.fn();
    const { getByRole } = renderCard({ onDetails, onOpen });

    fireEvent.pointerDown(getByRole("button", { name: "更多操作" }));
    const details = await waitFor(() => getByRole("menuitem", { name: "详情" }));
    details.click();
    expect(onDetails).toHaveBeenCalledWith(book);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the same actions from a right-click", async () => {
    const onOpen = vi.fn();
    const { getByTitle, getByRole } = renderCard({ onOpen });

    fireEvent.contextMenu(getByTitle("Test Book"));
    const open = await waitFor(() => getByRole("menuitem", { name: "打开" }));
    open.click();
    expect(onOpen).toHaveBeenCalledWith("abc");
  });

  it("hides menus in select mode", () => {
    const { queryByRole, queryByTitle } = renderCard({ selectMode: true });
    expect(queryByRole("button", { name: "更多操作" })).toBeNull();
    expect(queryByTitle("删除")).toBeNull();
  });

  it("cache-busts cover urls after a replace", () => {
    const { getByAltText } = renderCard({
      book: { ...book, coverPath: "/covers/a.jpg" },
      coverRev: 7,
    });
    expect(getByAltText("Test Book").getAttribute("src")).toBe("/covers/a.jpg?v=7");
  });
});

describe("BookCard — not cached state", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("marks a book whose file is not local as not downloaded", () => {
    const { getByRole } = renderCard({
      book: { ...book, cached: false },
    });
    // Icon-only on the cover; the label carries the meaning.
    expect(getByRole("img", { name: "Not downloaded" })).toBeTruthy();
  });

  it("does not mark cached books", () => {
    const { queryByRole } = renderCard({
      book: { ...book, cached: true },
    });
    expect(queryByRole("img", { name: "Not downloaded" })).toBeNull();
  });
});

describe("BookListRow — not cached state", () => {
  beforeEach(() => {
    setLocale("en");
  });

  const rowBook: BookRecord = { ...book, cached: false };

  it("marks an uncached book in list view", () => {
    const { getByText } = render(
      <BookListRow
        book={rowBook}
        onOpen={() => {}}
        onDelete={() => {}}
        onDetails={() => {}}
      />,
    );
    expect(getByText("Not downloaded")).toBeTruthy();
  });
});
