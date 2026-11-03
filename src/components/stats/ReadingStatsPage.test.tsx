// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ReadingStatsPage } from "@/components/stats/ReadingStatsPage";
import { setLocale } from "@/lib/i18n";
import { localDateKey, type ReadingLog } from "@/lib/reading-stats";
import { saveReadingStatsEnabled } from "@/lib/reading-stats-prefs";
import type { BookRecord } from "@/types/library";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));

const today = localDateKey(Date.now());
// Sittings carry their date in `start`; the time of day does not matter here.
const dayBefore = localDateKey(Date.now() - 86_400_000);

function sitting(id: string, bookId: string, date: string, seconds: number) {
  return {
    id,
    bookId,
    start: `${date}T12:00:00+00:00`,
    seconds,
    from: 0,
    to: 0.1,
    mode: "reader" as const,
  };
}

function book(id: string, title: string, lastFraction = 0.5): BookRecord {
  return {
    id,
    title,
    author: `${title} author`,
    coverPath: "",
    filePath: "",
    importedAt: "",
    lastFraction,
    readingStatus: "reading",
  };
}

function logs(): ReadingLog[] {
  return [
    {
      schemaVersion: 1,
      deviceId: "a",
      books: { gone: { title: "Gone Book", author: "Someone" } },
      sittings: [
        sitting("1", "one", today, 3600),
        sitting("2", "two", dayBefore, 7200),
        sitting("3", "gone", today, 600),
      ],
    },
  ];
}

function renderPage(onOpenBook = vi.fn()) {
  render(
    <ReadingStatsPage
      books={[book("one", "First Book"), book("two", "Second Book")]}
      onOpenBook={onOpenBook}
    />,
  );
  return onOpenBook;
}

describe("ReadingStatsPage", () => {
  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(logs());
  });
  afterEach(cleanup);

  it("explains an empty log, and still shows the page", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/recorded from now on/)).toBeTruthy();
    expect(screen.getByText("Nothing read in this period.")).toBeTruthy();
  });

  it("says when recording is off", async () => {
    saveReadingStatsEnabled(false);
    vi.mocked(invoke).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Recording is off/)).toBeTruthy();
  });

  it("reports a log that cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("nope"));
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not read/);
  });

  it("ranks Books by time and opens one", async () => {
    const onOpenBook = renderPage();
    await screen.findByText("Second Book");
    const section = screen.getByRole("region", { name: "Books" });
    const titles = within(section)
      .getAllByText(/Book$/)
      .map((node) => node.textContent);
    expect(titles).toEqual(["Second Book", "First Book", "Gone Book"]);
    fireEvent.click(screen.getByText("First Book"));
    expect(onOpenBook).toHaveBeenCalledWith("one");
  });

  it("labels a deleted Book from the log and does not open it", async () => {
    const onOpenBook = renderPage();
    const row = await screen.findByText("Gone Book");
    expect(screen.getByText("Deleted from the library")).toBeTruthy();
    expect(row.closest("button")).toBeNull();
    fireEvent.click(row);
    expect(onOpenBook).not.toHaveBeenCalled();
  });

  it("narrows the Books to a picked day and goes back", async () => {
    renderPage();
    await screen.findByText("Second Book");
    const cell = screen.getByRole("button", { name: new RegExp(": 1h 10m$") });
    fireEvent.click(cell);
    expect(cell.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Second Book")).toBeNull();
    expect(screen.getByText("First Book")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to period" }));
    expect(screen.getByText("Second Book")).toBeTruthy();
  });

  it("names a tapped bar, since a tooltip needs a pointer", async () => {
    renderPage();
    await screen.findByText("Second Book");
    const bars = screen.getByRole("region", { name: "Reading time" });
    const bar = within(bars).getByRole("img", { name: /· 1h 10m$/ });
    expect(within(bars).queryByText(/· 1h 10m$/)).toBeNull();
    fireEvent.click(bar);
    expect(within(bars).getByText(/· 1h 10m$/)).toBeTruthy();
  });

  it("moves between periods but not past the current one", async () => {
    renderPage();
    await screen.findByText("Second Book");
    const next = screen.getByRole<HTMLButtonElement>("button", { name: "Next period" });
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
    expect(next.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(screen.getByRole("button", { name: "Year" }).getAttribute("aria-pressed")).toBe("true");
    expect(next.disabled).toBe(true);
    expect(screen.getByText(today.slice(0, 4))).toBeTruthy();
  });

  it("moves through the heatmap with the arrow keys, from one Tab stop", async () => {
    renderPage();
    await screen.findByText("Second Book");
    const group = screen.getByRole("group", { name: "Past year" });
    const stops = within(group)
      .getAllByRole("button")
      .filter((cell) => cell.tabIndex === 0);
    expect(stops).toHaveLength(1);
    stops[0].focus();
    fireEvent.keyDown(stops[0], { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).not.toBe(stops[0]));
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
  });

  it("reloads when a Sync brings other devices' logs", async () => {
    renderPage();
    await screen.findByText("Second Book");
    vi.mocked(invoke).mockResolvedValue([]);
    window.dispatchEvent(new Event("litera:reading-logs-synced"));
    expect(await screen.findByText(/recorded from now on/)).toBeTruthy();
  });
});
