import { describe, expect, it } from "vitest";
import { formatSessionTime, sessionTimeGroup } from "@/lib/session-time";

// Local-time constructors keep the calendar-day math timezone-independent.
const now = new Date(2026, 9, 13, 10, 0);
const iso = (...parts: [number, number, number, number, number, number?]) =>
  new Date(...parts).toISOString();

describe("sessionTimeGroup", () => {
  it("groups by calendar day, not by 24 hours", () => {
    expect(sessionTimeGroup(iso(2026, 9, 13, 0, 5), now)).toBe("today");
    expect(sessionTimeGroup(iso(2026, 9, 12, 23, 59), now)).toBe("yesterday");
    expect(sessionTimeGroup(iso(2026, 9, 12, 0, 1), now)).toBe("yesterday");
  });

  it("puts the rest of the last 7 days in week, then earlier", () => {
    expect(sessionTimeGroup(iso(2026, 9, 11, 21, 14), now)).toBe("week");
    expect(sessionTimeGroup(iso(2026, 9, 7, 9, 0), now)).toBe("week");
    expect(sessionTimeGroup(iso(2026, 9, 6, 9, 0), now)).toBe("earlier");
  });

  it("keeps a clock-skewed future time in today", () => {
    expect(sessionTimeGroup(iso(2026, 9, 14, 9, 0), now)).toBe("today");
  });

  it("puts an unparseable time in earlier", () => {
    expect(sessionTimeGroup("not a date", now)).toBe("earlier");
  });
});

describe("formatSessionTime", () => {
  it("shows only the time today and yesterday, the heading names the day", () => {
    expect(formatSessionTime(iso(2026, 9, 13, 9, 14, 33), "zh-CN", now)).toBe("09:14");
    expect(formatSessionTime(iso(2026, 9, 12, 23, 59), "zh-CN", now)).toBe("23:59");
  });

  it("shows month and day earlier this year, and the year before that", () => {
    expect(formatSessionTime(iso(2026, 9, 11, 21, 14), "zh-CN", now)).toBe("10月11日");
    expect(formatSessionTime(iso(2025, 9, 12, 21, 14), "zh-CN", now)).toBe("2025年10月12日");
  });

  it("follows the locale", () => {
    expect(formatSessionTime(iso(2026, 9, 13, 21, 14), "en", now)).toBe("21:14");
    expect(formatSessionTime(iso(2026, 9, 11, 21, 14), "en", now)).toBe("Oct 11");
    expect(formatSessionTime(iso(2025, 9, 12, 21, 14), "en", now)).toBe("Oct 12, 2025");
  });

  it("returns an empty string for an unparseable time", () => {
    expect(formatSessionTime("not a date", "zh-CN", now)).toBe("");
  });
});
