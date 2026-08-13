// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookCard } from "@/components/BookCard";
import type { BookRecord } from "@/types/library";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

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

describe("BookCard", () => {
  it("shows progress only when lastFraction is set", () => {
    const { rerender, queryByText, getByText } = render(
      <BookCard book={book} onOpen={() => {}} onDelete={() => {}} />,
    );
    expect(queryByText("0%")).toBeNull();
    expect(queryByText("42%")).toBeNull();

    rerender(
      <BookCard
        book={{ ...book, lastFraction: 0 }}
        onOpen={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(getByText("0%")).toBeTruthy();

    rerender(
      <BookCard
        book={{ ...book, lastFraction: 0.42 }}
        onOpen={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(getByText("42%")).toBeTruthy();
  });

  it("does not open when openDisabled", () => {
    const onOpen = vi.fn();
    const { getByTitle } = render(
      <BookCard book={book} onOpen={onOpen} onDelete={() => {}} openDisabled />,
    );

    getByTitle("Test Book").click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("toggles selection in select mode instead of opening", () => {
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    const { getByTitle } = render(
      <BookCard
        book={book}
        onOpen={onOpen}
        onDelete={() => {}}
        selectMode
        onToggleSelect={onToggleSelect}
      />,
    );

    getByTitle("Test Book").click();
    expect(onToggleSelect).toHaveBeenCalledWith("abc");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("requests delete without using window.confirm", () => {
    const onDelete = vi.fn();
    const confirm = vi.spyOn(window, "confirm");
    const { getByTitle } = render(
      <BookCard book={book} onOpen={() => {}} onDelete={onDelete} />,
    );

    getByTitle("删除").click();
    expect(onDelete).toHaveBeenCalledWith("abc");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
