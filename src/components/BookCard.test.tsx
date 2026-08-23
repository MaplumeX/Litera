// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookCard } from "@/components/BookCard";
import type { BookRecord } from "@/types/library";

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

  it("requests delete without using window.confirm", () => {
    const onDelete = vi.fn();
    const confirm = vi.spyOn(window, "confirm");
    const { getByTitle } = renderCard({ onDelete });

    const remove = getByTitle("删除");
    expect(remove.getAttribute("aria-label")).toBe("删除");
    expect(remove.querySelector("svg")).toBeTruthy();
    expect(remove.textContent).not.toContain("✕");
    remove.click();
    expect(onDelete).toHaveBeenCalledWith("abc");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
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

  it("can hide the hover delete control while keeping the context menu", async () => {
    const onDelete = vi.fn();
    const { getByTitle, queryByTitle, getByRole } = renderCard({
      showDelete: false,
      showMenu: false,
      onDelete,
    });
    expect(queryByTitle("删除")).toBeNull();
    fireEvent.contextMenu(getByTitle("Test Book"));
    const remove = await waitFor(() => getByRole("menuitem", { name: "删除" }));
    remove.click();
    expect(onDelete).toHaveBeenCalledWith("abc");
  });

  it("cache-busts cover urls after a replace", () => {
    const { getByAltText } = renderCard({
      book: { ...book, coverPath: "/covers/a.jpg" },
      coverRev: 7,
    });
    expect(getByAltText("Test Book").getAttribute("src")).toBe("/covers/a.jpg?v=7");
  });
});
