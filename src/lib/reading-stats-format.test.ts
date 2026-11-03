import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import {
  formatChange,
  formatDuration,
  formatPeriod,
} from "@/lib/reading-stats-format";

describe("reading stats formats", () => {
  beforeEach(() => setLocale("en"));

  it("rounds minutes down and drops what is zero", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("<1m");
    expect(formatDuration(119)).toBe("1m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(66_240)).toBe("18h 24m");
  });

  it("signs a change", () => {
    expect(formatChange(0.124)).toBe("+12%");
    expect(formatChange(-1)).toBe("-100%");
    expect(formatChange(0)).toBe("0%");
  });

  it("names a period in the local calendar, whatever the timezone", () => {
    expect(formatPeriod("year", { start: "2026-01-01", end: "2026-12-31" })).toBe("2026");
    expect(formatPeriod("month", { start: "2026-11-01", end: "2026-11-30" })).toBe("November 2026");
    expect(formatPeriod("week", { start: "2026-11-02", end: "2026-11-08" })).toBe("Nov 2 – Nov 8");
  });

  it("speaks Chinese too", () => {
    setLocale("zh-CN");
    expect(formatDuration(66_240)).toBe("18 小时 24 分");
    expect(formatPeriod("month", { start: "2026-11-01", end: "2026-11-30" })).toBe("2026年11月");
  });
});
