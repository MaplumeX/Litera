// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadingLogSyncNotice } from "@/components/stats/ReadingLogSyncNotice";
import { setLocale } from "@/lib/i18n";
import { noteReadingLogUploaded } from "@/lib/reading-stats-prefs";

describe("ReadingLogSyncNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
  });
  afterEach(cleanup);

  it("appears after the first upload and stays gone once dismissed", () => {
    const { unmount } = render(<ReadingLogSyncNotice />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => noteReadingLogUploaded());
    const notice = screen.getByRole("status");
    expect(notice.textContent).toMatch(/plaintext/);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => noteReadingLogUploaded());
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    render(<ReadingLogSyncNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is still due after a restart when not dismissed", () => {
    noteReadingLogUploaded();
    render(<ReadingLogSyncNotice />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
