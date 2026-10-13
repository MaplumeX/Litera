import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { formatSessionTime } from "@/lib/session-time";

afterEach(() => {
  setLocale("zh-CN");
});

// Local-time constructors keep the calendar-day math timezone-independent.
const now = new Date(2026, 9, 13, 10, 0);
const iso = (...parts: [number, number, number, number, number, number?]) =>
  new Date(...parts).toISOString();

describe("formatSessionTime", () => {
  it("shows the time without seconds for today", () => {
    setLocale("zh-CN");
    expect(formatSessionTime(iso(2026, 9, 13, 9, 14, 33), "zh-CN", now)).toBe("今天 09:14");
    expect(formatSessionTime(iso(2026, 9, 13, 0, 5), "zh-CN", now)).toBe("今天 00:05");
  });

  it("says yesterday by calendar day, not by 24 hours", () => {
    setLocale("zh-CN");
    expect(formatSessionTime(iso(2026, 9, 12, 23, 59), "zh-CN", now)).toBe("昨天");
    expect(formatSessionTime(iso(2026, 9, 12, 0, 1), "zh-CN", now)).toBe("昨天");
  });

  it("shows month and day earlier this year, and the year before that", () => {
    expect(formatSessionTime(iso(2026, 9, 11, 21, 14), "zh-CN", now)).toBe("10月11日");
    expect(formatSessionTime(iso(2025, 9, 12, 21, 14), "zh-CN", now)).toBe("2025年10月12日");
  });

  it("follows the locale", () => {
    setLocale("en");
    expect(formatSessionTime(iso(2026, 9, 13, 21, 14), "en", now)).toBe("Today 21:14");
    expect(formatSessionTime(iso(2026, 9, 12, 21, 14), "en", now)).toBe("Yesterday");
    expect(formatSessionTime(iso(2026, 9, 11, 21, 14), "en", now)).toBe("Oct 11");
    expect(formatSessionTime(iso(2025, 9, 12, 21, 14), "en", now)).toBe("Oct 12, 2025");
  });

  it("returns an empty string for an unparseable time", () => {
    expect(formatSessionTime("not a date", "zh-CN", now)).toBe("");
  });
});
