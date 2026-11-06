// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookRecord } from "@/types/library";
import { BookActionSheetProvider, type BookActionHandlers } from "@/components/BookActionsMenu";
import { MobileContinueHero } from "@/mobile/MobileContinueHero";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

function book(id: string, title: string, lastFraction: number): BookRecord {
  return {
    id,
    title,
    author: "作者",
    coverPath: "",
    filePath: `/books/${id}/book.epub`,
    importedAt: "2026-01-01T00:00:00Z",
    readingStatus: "reading",
    lastFraction,
    cached: true,
  };
}

const BOOKS = [book("a", "甲书", 0.4), book("b", "乙书", 0.1)];

afterEach(cleanup);

function setup() {
  const onOpen = vi.fn();
  const openSheet = vi.fn();
  const actionsFor = (target: BookRecord): BookActionHandlers => ({
    bookId: target.id,
    onOpen: () => onOpen(target.id),
    onDetails: vi.fn(),
    onDelete: vi.fn(),
  });
  const screen = render(
    <BookActionSheetProvider value={openSheet}>
      <MobileContinueHero books={BOOKS} actionsFor={actionsFor} coverRev={{}} openingBookId={null} disabled={false} />
    </BookActionSheetProvider>,
  );
  const hero = screen.getByRole("region", { name: "继续阅读" });
  const strip = (title: string) =>
    within(hero).getAllByTitle(title).find((el) => el.hasAttribute("aria-pressed")) as HTMLElement;
  return { hero, strip, onOpen, openSheet };
}

describe("MobileContinueHero", () => {
  it("shows the Book last read, with its progress", () => {
    const { hero } = setup();
    expect(within(hero).getByText("甲书")).toBeTruthy();
    expect(within(hero).getByText("40%")).toBeTruthy();
  });

  it("shows a small cover's Book on the first tap and opens it on the second", () => {
    const { hero, strip, onOpen } = setup();
    fireEvent.click(strip("乙书"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(within(hero).getByText("乙书")).toBeTruthy();
    expect(within(hero).getByText("10%")).toBeTruthy();
    expect(strip("乙书").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(strip("乙书"));
    expect(onOpen).toHaveBeenCalledWith("b");
  });

  it("opens the shown Book from Resume", () => {
    const { hero, onOpen } = setup();
    fireEvent.click(within(hero).getByRole("button", { name: "继续" }));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("opens a Book's actions on long-press", () => {
    const { strip, openSheet } = setup();
    fireEvent.contextMenu(strip("乙书"));
    expect(openSheet).toHaveBeenCalledWith(expect.objectContaining({ bookId: "b" }));
  });
});
