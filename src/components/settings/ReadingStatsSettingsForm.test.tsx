// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadingStatsSettingsForm } from "@/components/settings/ReadingStatsSettingsForm";
import { loadReadingStatsEnabled } from "@/lib/reading-stats-prefs";

describe("ReadingStatsSettingsForm", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("turns recording off and on", () => {
    render(<ReadingStatsSettingsForm />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(loadReadingStatsEnabled()).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(loadReadingStatsEnabled()).toBe(true);
  });
});
