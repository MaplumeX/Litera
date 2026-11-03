// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadReadingStatsEnabled,
  READING_STATS_ENABLED_KEY,
  saveReadingStatsEnabled,
} from "@/lib/reading-stats-prefs";

describe("reading stats preference", () => {
  beforeEach(() => localStorage.clear());

  it("is on by default", () => {
    expect(loadReadingStatsEnabled()).toBe(true);
  });

  it("remembers being turned off and on", () => {
    saveReadingStatsEnabled(false);
    expect(localStorage.getItem(READING_STATS_ENABLED_KEY)).toBe("false");
    expect(loadReadingStatsEnabled()).toBe(false);
    saveReadingStatsEnabled(true);
    expect(loadReadingStatsEnabled()).toBe(true);
  });
});
