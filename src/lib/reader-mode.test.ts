// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_READER_MODE,
  DEFAULT_READER_MODE_KEY,
  isReaderMode,
  loadDefaultReaderMode,
  parseReaderMode,
  resolveReaderMode,
  saveDefaultReaderMode,
} from "./reader-mode";

afterEach(() => {
  localStorage.removeItem(DEFAULT_READER_MODE_KEY);
  vi.restoreAllMocks();
});

describe("isReaderMode / parseReaderMode", () => {
  it("accepts reader and agent", () => {
    expect(isReaderMode("reader")).toBe(true);
    expect(isReaderMode("agent")).toBe(true);
    expect(isReaderMode("other")).toBe(false);
    expect(isReaderMode(null)).toBe(false);
  });

  it("falls back to reader for invalid values", () => {
    expect(parseReaderMode("agent")).toBe("agent");
    expect(parseReaderMode("reader")).toBe("reader");
    expect(parseReaderMode("nope")).toBe(DEFAULT_READER_MODE);
    expect(parseReaderMode(undefined)).toBe(DEFAULT_READER_MODE);
    expect(parseReaderMode(1)).toBe(DEFAULT_READER_MODE);
  });
});

describe("loadDefaultReaderMode / saveDefaultReaderMode", () => {
  it("returns reader when nothing is saved", () => {
    expect(loadDefaultReaderMode()).toBe("reader");
  });

  it("round-trips a saved mode", () => {
    saveDefaultReaderMode("agent");
    expect(localStorage.getItem(DEFAULT_READER_MODE_KEY)).toBe("agent");
    expect(loadDefaultReaderMode()).toBe("agent");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "dark");
    expect(loadDefaultReaderMode()).toBe("reader");
  });
});

describe("resolveReaderMode", () => {
  it("prefers a valid book memory over the app default", () => {
    saveDefaultReaderMode("reader");
    expect(resolveReaderMode("agent")).toBe("agent");
  });

  it("uses the app default when the book has no memory", () => {
    saveDefaultReaderMode("agent");
    expect(resolveReaderMode(undefined)).toBe("agent");
    expect(resolveReaderMode("nope")).toBe("agent");
  });

  it("falls back to reader when both are unset or invalid", () => {
    expect(resolveReaderMode(undefined)).toBe("reader");
    localStorage.setItem(DEFAULT_READER_MODE_KEY, "???");
    expect(resolveReaderMode("???")).toBe("reader");
  });
});
