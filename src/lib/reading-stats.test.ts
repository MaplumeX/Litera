import { describe, expect, it } from "vitest";
import {
  allSittings,
  allTimeSummary,
  bookTotals,
  currentStreak,
  dailySeries,
  heatmapDays,
  localDateKey,
  monthlySeries,
  periodRange,
  shiftPeriod,
  sittingDate,
  summarizePeriod,
  type ReadingLog,
  type StatsBook,
} from "@/lib/reading-stats";
import type { Sitting } from "@/lib/sitting-tracker";

let nextId = 0;

function sitting(start: string, seconds: number, bookId = "book-1"): Sitting {
  nextId += 1;
  return {
    id: `s${nextId}`,
    bookId,
    start: start.includes("T") ? start : `${start}T12:00:00+08:00`,
    seconds,
    from: 0,
    to: 0.1,
    mode: "reader",
  };
}

function log(deviceId: string, sittings: Sitting[], books: ReadingLog["books"] = {}): ReadingLog {
  return { schemaVersion: 1, deviceId, books, sittings };
}

function book(id: string, overrides: Partial<StatsBook> = {}): StatsBook {
  return { id, title: id, author: "Author", readingStatus: "reading", ...overrides };
}

/** The instant of a local wall-clock time, as Rust's UTC timestamps record it. */
function utcStampOfLocal(year: number, monthIndex: number, day: number, hour: number): string {
  return new Date(year, monthIndex, day, hour).toISOString();
}

describe("periodRange", () => {
  it("runs a week from Monday to Sunday", () => {
    // 2026-11-03 is a Tuesday.
    expect(periodRange("week", "2026-11-03")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(periodRange("week", "2026-11-02")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(periodRange("week", "2026-11-08")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
  });

  it("handles month lengths and leap years", () => {
    expect(periodRange("month", "2026-11-03")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(periodRange("month", "2028-02-10").end).toBe("2028-02-29");
    expect(periodRange("month", "2026-02-10").end).toBe("2026-02-28");
    expect(periodRange("month", "2026-12-31").end).toBe("2026-12-31");
  });

  it("covers the calendar year", () => {
    expect(periodRange("year", "2026-11-03")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
});

describe("shiftPeriod", () => {
  it("moves across month, year and week boundaries", () => {
    expect(shiftPeriod("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftPeriod("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftPeriod("year", "2026-06-01", -1)).toBe("2025-01-01");
    expect(shiftPeriod("week", "2026-11-03", 1)).toBe("2026-11-09");
    expect(shiftPeriod("week", "2026-01-01", -1)).toBe("2025-12-22");
  });
});

describe("sittingDate", () => {
  it("is the date as lived, whatever the viewing device's timezone", () => {
    expect(sittingDate(sitting("2026-11-03T23:50:00+08:00", 60))).toBe("2026-11-03");
    expect(sittingDate(sitting("2026-11-03T00:10:00-08:00", 60))).toBe("2026-11-03");
  });
});

describe("localDateKey", () => {
  it("is the local date of an instant, late in the day or early", () => {
    expect(localDateKey(new Date(2026, 10, 3, 23, 30).getTime())).toBe("2026-11-03");
    expect(localDateKey(new Date(2026, 10, 3, 0, 30).getTime())).toBe("2026-11-03");
  });
});

describe("allSittings", () => {
  it("sums devices and skips another device's bad entries", () => {
    const logs = [
      log("a", [sitting("2026-11-03", 60)]),
      log("b", [
        sitting("2026-11-03", 30),
        { ...sitting("2026-11-03", 10), start: "yesterday" },
        { ...sitting("2026-11-03", 10), seconds: Number.NaN },
        { ...sitting("2026-11-03", 10), seconds: 0 },
      ]),
    ];
    expect(allSittings(logs).map((s) => s.seconds)).toEqual([60, 30]);
  });
});

describe("summarizePeriod", () => {
  const today = "2026-11-03";

  it("totals time and distinct days, summed across devices", () => {
    const sittings = allSittings([
      log("a", [sitting("2026-11-01", 600), sitting("2026-11-03", 300)]),
      log("b", [sitting("2026-11-03", 300), sitting("2026-10-31", 9000)]),
    ]);
    const summary = summarizePeriod(sittings, [], "month", today, today);
    expect(summary.seconds).toBe(1200);
    expect(summary.daysRead).toBe(2);
  });

  it("averages over the days so far, including unread ones", () => {
    const sittings = [sitting("2026-11-01", 900)];
    expect(summarizePeriod(sittings, [], "month", today, today).dailyAverageSeconds).toBe(300);
    // A finished month counts all its days.
    const october = [sitting("2026-10-05", 3100)];
    expect(summarizePeriod(october, [], "month", "2026-10-01", today).dailyAverageSeconds).toBe(100);
  });

  it("gives a future period nothing", () => {
    const summary = summarizePeriod([], [], "month", "2026-12-01", today);
    expect(summary).toEqual({
      seconds: 0,
      daysRead: 0,
      dailyAverageSeconds: 0,
      change: null,
      finished: 0,
    });
  });

  it("compares with the same stretch of the previous period", () => {
    const sittings = [
      sitting("2026-11-02", 150),
      sitting("2026-10-02", 100),
      // Later in October: outside the first three days, so not compared.
      sitting("2026-10-20", 10_000),
    ];
    expect(summarizePeriod(sittings, [], "month", today, today).change).toBeCloseTo(0.5);
  });

  it("compares whole periods once a period is over, clipping to a shorter one", () => {
    const sittings = [sitting("2026-03-31", 200), sitting("2026-02-28", 100)];
    expect(summarizePeriod(sittings, [], "month", "2026-03-01", today).change).toBeCloseTo(1);
  });

  it("has no change with nothing to compare, and can fall to -100%", () => {
    const first = [sitting("2026-11-02", 150)];
    expect(summarizePeriod(first, [], "month", today, today).change).toBeNull();
    const stopped = [sitting("2026-10-02", 150)];
    expect(summarizePeriod(stopped, [], "month", today, today).change).toBe(-1);
  });

  it("counts Books finished in the period, by local date", () => {
    const books = [
      book("in", {
        readingStatus: "finished",
        statusUpdatedAt: utcStampOfLocal(2026, 10, 1, 23),
      }),
      book("first-minute", {
        readingStatus: "finished",
        statusUpdatedAt: new Date(2026, 10, 1, 0, 1).toISOString(),
      }),
      book("before", {
        readingStatus: "finished",
        statusUpdatedAt: new Date(2026, 9, 31, 23, 59).toISOString(),
      }),
      book("backfilled", { readingStatus: "finished" }),
      book("garbled", { readingStatus: "finished", statusUpdatedAt: "soon" }),
      book("still-reading", {
        readingStatus: "reading",
        statusUpdatedAt: utcStampOfLocal(2026, 10, 2, 12),
      }),
    ];
    expect(summarizePeriod([], books, "month", today, today).finished).toBe(2);
  });
});

describe("allTimeSummary", () => {
  it("counts backfilled finished Books, which have no date", () => {
    const summary = allTimeSummary(
      [sitting("2026-11-01", 100), sitting("2026-11-01", 50), sitting("2025-01-01", 10)],
      [book("a", { readingStatus: "finished" }), book("b")],
    );
    expect(summary).toEqual({ seconds: 160, daysRead: 2, finished: 1 });
  });
});

describe("currentStreak", () => {
  const today = "2026-11-03";

  it("counts days in a row ending today", () => {
    const sittings = ["2026-11-03", "2026-11-02", "2026-11-01", "2026-10-30"].map((d) =>
      sitting(d, 60),
    );
    expect(currentStreak(sittings, today)).toBe(3);
  });

  it("keeps the streak when today is not read yet", () => {
    const sittings = ["2026-11-02", "2026-11-01"].map((d) => sitting(d, 60));
    expect(currentStreak(sittings, today)).toBe(2);
  });

  it("is broken by a day missed before yesterday", () => {
    expect(currentStreak([sitting("2026-11-01", 60)], today)).toBe(0);
    expect(currentStreak([], today)).toBe(0);
  });

  it("crosses months and counts a day once", () => {
    const sittings = ["2026-11-01", "2026-11-01", "2026-10-31"].map((d) => sitting(d, 60));
    expect(currentStreak(sittings, "2026-11-01")).toBe(2);
  });
});

describe("series", () => {
  it("fills a day range, including unread days", () => {
    const series = dailySeries(
      [sitting("2026-11-02", 60), sitting("2026-11-02", 30), sitting("2026-11-09", 5)],
      periodRange("week", "2026-11-03"),
    );
    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({ key: "2026-11-02", seconds: 90 });
    expect(series[6]).toEqual({ key: "2026-11-08", seconds: 0 });
  });

  it("fills twelve months of one year only", () => {
    const series = monthlySeries(
      [sitting("2026-01-31", 60), sitting("2026-12-01", 30), sitting("2025-06-01", 999)],
      "2026",
    );
    expect(series).toHaveLength(12);
    expect(series[0]).toEqual({ key: "2026-01", seconds: 60 });
    expect(series[5].seconds).toBe(0);
    expect(series[11]).toEqual({ key: "2026-12", seconds: 30 });
  });

  it("starts the heatmap on a Monday and ends it today", () => {
    const days = heatmapDays([sitting("2026-11-03", 60)], "2026-11-03");
    expect(new Date(`${days[0].key}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(days.at(-1)).toEqual({ key: "2026-11-03", seconds: 60 });
    // 51 whole weeks, then Monday and Tuesday of this one.
    expect(days).toHaveLength(51 * 7 + 2);
  });
});

describe("bookTotals", () => {
  const range = { start: "2026-11-01", end: "2026-11-30" };

  it("ranks by time across devices, within the range only", () => {
    const logs = [
      log("a", [sitting("2026-11-01", 100, "one"), sitting("2026-11-02", 500, "two")]),
      log("b", [sitting("2026-11-03", 450, "one"), sitting("2026-10-31", 9999, "two")]),
    ];
    const totals = bookTotals(logs, [book("one"), book("two")], range);
    expect(totals.map((t) => [t.bookId, t.seconds])).toEqual([
      ["one", 550],
      ["two", 500],
    ]);
  });

  it("reports the latest Sitting as an instant, not by comparing text", () => {
    const logs = [
      log("a", [sitting("2026-11-03T09:00:00+08:00", 60, "one")]),
      // Earlier text, later instant.
      log("b", [sitting("2026-11-03T08:00:00-08:00", 60, "one")]),
    ];
    expect(bookTotals(logs, [book("one")], range)[0].lastRead).toBe("2026-11-03T08:00:00-08:00");
  });

  it("takes labels and progress from the Library", () => {
    const logs = [
      log("a", [sitting("2026-11-01", 60, "one")], { one: { title: "Old title", author: "Old" } }),
    ];
    const [total] = bookTotals(
      logs,
      [book("one", { title: "New title", author: "New", lastFraction: 0.64 })],
      range,
    );
    expect(total).toMatchObject({
      title: "New title",
      author: "New",
      fraction: 0.64,
      deleted: false,
    });
  });

  it("labels a deleted Book from the log", () => {
    const logs = [
      log("a", [sitting("2026-11-01", 60, "gone")], { gone: { title: "Kept", author: "Writer" } }),
    ];
    const [total] = bookTotals(logs, [], range);
    expect(total).toMatchObject({ title: "Kept", author: "Writer", deleted: true });
    expect(total.fraction).toBeUndefined();
  });

  it("finds a deleted Book's label in another device's log", () => {
    const logs = [
      log("a", [sitting("2026-11-01", 60, "gone")]),
      log("b", [], { gone: { title: "Kept", author: "Writer" } }),
    ];
    expect(bookTotals(logs, [], range)[0].title).toBe("Kept");
  });

  it("narrows to one day for a picked heatmap day", () => {
    const logs = [log("a", [sitting("2026-11-01", 60, "one"), sitting("2026-11-02", 30, "two")])];
    const totals = bookTotals(logs, [book("one"), book("two")], {
      start: "2026-11-02",
      end: "2026-11-02",
    });
    expect(totals.map((t) => t.bookId)).toEqual(["two"]);
  });
});
