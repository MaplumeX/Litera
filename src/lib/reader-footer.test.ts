// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_READER_FOOTER,
  READER_FOOTER_KEY,
  loadReaderFooter,
  parseReaderFooter,
  saveReaderFooter,
} from "./reader-footer";

afterEach(() => {
  vi.restoreAllMocks();
  saveReaderFooter(DEFAULT_READER_FOOTER);
  localStorage.clear();
});

describe("device-local reader footer preferences", () => {
  it.each([null, "broken", "null", "[]", "42"])("uses defaults for invalid storage: %s", (raw) => {
    expect(parseReaderFooter(raw)).toEqual(DEFAULT_READER_FOOTER);
  });

  it("recovers invalid positions independently and keeps disabled slots", () => {
    expect(parseReaderFooter(JSON.stringify({ enabled: false, left: "battery", center: "none", right: "unknown" })))
      .toEqual({ enabled: false, left: "battery", center: "none", right: "book-progress" });
  });

  it("merges patches into localStorage and reloads a persisted preference", () => {
    saveReaderFooter({ left: "time", right: "battery" });
    saveReaderFooter({ center: "none" });
    const expected = { enabled: true, left: "time", center: "none", right: "battery" };
    expect(JSON.parse(localStorage.getItem(READER_FOOTER_KEY)!)).toEqual(expected);
    expect(loadReaderFooter()).toEqual(expected);
    localStorage.setItem(READER_FOOTER_KEY, JSON.stringify({ ...expected, enabled: false }));
    expect(loadReaderFooter().enabled).toBe(false);
  });

  it("keeps changes in memory if localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    saveReaderFooter({ right: "battery" });
    expect(loadReaderFooter().right).toBe("battery");
  });
});
