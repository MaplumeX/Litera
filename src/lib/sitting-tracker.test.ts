import { beforeEach, describe, expect, it } from "vitest";
import {
  IDLE_CAP_MS,
  localTimestamp,
  MIN_SITTING_SECONDS,
  SittingTracker,
  type Sitting,
} from "@/lib/sitting-tracker";

const NOON = new Date(2026, 10, 3, 12, 0, 0).getTime();
const MINUTE = 60_000;

describe("SittingTracker", () => {
  let time: number;
  let enabled: boolean;
  let writes: Sitting[];
  let tracker: SittingTracker;

  /** Latest written state of each Sitting, in the order they first appeared. */
  const sittings = () => [...new Map(writes.map((s) => [s.id, s])).values()];
  const advance = (ms: number) => {
    time += ms;
  };

  beforeEach(() => {
    time = NOON;
    enabled = true;
    writes = [];
    let nextId = 0;
    tracker = new SittingTracker({
      write: (sitting) => writes.push(sitting),
      isEnabled: () => enabled,
      now: () => time,
      newId: () => `s${++nextId}`,
    });
  });

  it("credits the time between activities and writes it when the Book closes", () => {
    tracker.begin("book", 0.1, "reader");
    advance(MINUTE);
    tracker.activity();
    advance(MINUTE);
    tracker.end();
    expect(sittings()).toEqual([
      expect.objectContaining({ id: "s1", bookId: "book", seconds: 120, mode: "reader" }),
    ]);
  });

  it("counts a Book left open for one capped gap only", () => {
    tracker.begin("book", 0, "reader");
    advance(8 * 60 * MINUTE);
    tracker.end();
    expect(sittings()[0].seconds).toBe(IDLE_CAP_MS / 1000);
  });

  it("credits one capped gap across repeated checkpoints of an idle Book", () => {
    tracker.begin("book", 0, "reader");
    for (let i = 0; i < 30; i += 1) {
      advance(MINUTE);
      tracker.checkpoint();
    }
    tracker.end();
    expect(sittings()).toHaveLength(1);
    expect(sittings()[0].seconds).toBe(IDLE_CAP_MS / 1000);
  });

  it("ends the Sitting on a gap over the cap and starts a new one", () => {
    tracker.begin("book", 0, "reader");
    advance(10 * MINUTE);
    tracker.activity();
    advance(MINUTE);
    tracker.end();
    expect(sittings().map((s) => s.seconds)).toEqual([IDLE_CAP_MS / 1000, 60]);
  });

  it("drops a Sitting under the minimum and never writes it", () => {
    tracker.begin("book", 0, "reader");
    advance((MIN_SITTING_SECONDS - 1) * 1000);
    tracker.checkpoint();
    tracker.end();
    expect(writes).toEqual([]);
  });

  it("keeps a Sitting exactly at the minimum", () => {
    tracker.begin("book", 0, "reader");
    advance(MIN_SITTING_SECONDS * 1000);
    tracker.end();
    expect(sittings()[0].seconds).toBe(MIN_SITTING_SECONDS);
  });

  it("splits a Sitting at local midnight", () => {
    time = new Date(2026, 10, 3, 23, 59, 0).getTime();
    tracker.begin("book", 0, "reader");
    advance(2 * MINUTE);
    tracker.activity();
    advance(MINUTE);
    tracker.end();
    const [first, second] = sittings();
    expect(first.seconds).toBe(120);
    expect(first.start.startsWith("2026-11-03T23:59:00")).toBe(true);
    expect(second.seconds).toBe(60);
    expect(second.start.startsWith("2026-11-04T00:01:00")).toBe(true);
  });

  it("does not count hidden time and continues the Sitting on return within the cap", () => {
    tracker.begin("book", 0, "reader");
    advance(MINUTE);
    tracker.setVisible(false);
    advance(2 * MINUTE);
    tracker.setVisible(true);
    advance(MINUTE);
    tracker.end();
    expect(sittings()).toEqual([expect.objectContaining({ id: "s1", seconds: 120 })]);
  });

  it("starts a new Sitting on return past the cap", () => {
    tracker.begin("book", 0, "reader");
    advance(MINUTE);
    tracker.setVisible(false);
    advance(30 * MINUTE);
    tracker.setVisible(true);
    advance(MINUTE);
    tracker.end();
    expect(sittings().map((s) => s.seconds)).toEqual([60, 60]);
  });

  it("saves on hide, so a phone that kills the app loses nothing", () => {
    tracker.begin("book", 0, "reader");
    advance(MINUTE);
    tracker.setVisible(false);
    expect(sittings()[0].seconds).toBe(60);
    advance(60 * MINUTE);
    tracker.activity();
    tracker.checkpoint();
    expect(writes).toHaveLength(1);
  });

  it("ignores the restoring relocate and re-pagination, and counts real moves", () => {
    tracker.begin("book", 0.2, "reader");
    tracker.relocate(0.25);
    advance(10 * MINUTE);
    // Were this activity, it would end the Sitting for the gap over the cap.
    tracker.relocate(0.25 + 1e-5);
    expect(writes).toEqual([]);
    tracker.relocate(0.3);
    expect(sittings()).toEqual([
      expect.objectContaining({ seconds: IDLE_CAP_MS / 1000, from: 0.25 }),
    ]);
  });

  it("records where the position started and reached", () => {
    tracker.begin("book", 0.2, "reader");
    tracker.relocate(0.2);
    advance(MINUTE);
    tracker.relocate(0.3);
    advance(MINUTE);
    tracker.relocate(0.35);
    tracker.end();
    expect(sittings()[0]).toMatchObject({ from: 0.2, to: 0.35 });
  });

  it("starts a new Sitting when the mode switches", () => {
    tracker.begin("book", 0, "reader");
    advance(MINUTE);
    tracker.setMode("agent");
    advance(MINUTE);
    tracker.setMode("agent");
    tracker.end();
    expect(sittings().map((s) => [s.mode, s.seconds])).toEqual([
      ["reader", 60],
      ["agent", 60],
    ]);
  });

  it("counts heartbeats during a long answer with no input", () => {
    tracker.begin("book", 0, "agent");
    for (let i = 0; i < 40; i += 1) {
      advance(15_000);
      tracker.activity();
    }
    tracker.end();
    expect(sittings()).toEqual([expect.objectContaining({ seconds: 600, mode: "agent" })]);
  });

  it("rewrites the same id at each checkpoint, and only when it changed", () => {
    tracker.begin("book", 0, "reader");
    advance(MINUTE);
    tracker.activity();
    tracker.checkpoint();
    tracker.checkpoint();
    advance(MINUTE);
    tracker.activity();
    tracker.checkpoint();
    expect(writes.map((s) => [s.id, s.seconds])).toEqual([
      ["s1", 60],
      ["s1", 120],
    ]);
  });

  it("ends the previous Book when another opens", () => {
    tracker.begin("one", 0, "reader");
    advance(MINUTE);
    tracker.begin("two", 0, "reader");
    advance(MINUTE);
    tracker.end();
    expect(sittings().map((s) => [s.bookId, s.seconds])).toEqual([
      ["one", 60],
      ["two", 60],
    ]);
  });

  it("records nothing while off, and starts fresh when turned back on", () => {
    tracker.begin("book", 0, "reader");
    advance(MINUTE);
    enabled = false;
    tracker.activity();
    advance(MINUTE);
    tracker.checkpoint();
    expect(writes).toEqual([]);
    enabled = true;
    tracker.activity();
    advance(MINUTE);
    tracker.end();
    expect(sittings().map((s) => s.seconds)).toEqual([60]);
  });

  it("does nothing with no Book open", () => {
    tracker.activity();
    tracker.relocate(0.5);
    tracker.setMode("agent");
    tracker.checkpoint();
    tracker.end();
    expect(writes).toEqual([]);
  });
});

describe("localTimestamp", () => {
  it("is the same instant, in local time, with an offset", () => {
    const value = localTimestamp(NOON);
    expect(value).toMatch(/^2026-11-03T12:00:00[+-]\d{2}:\d{2}$/);
    expect(Date.parse(value)).toBe(NOON);
  });
});
