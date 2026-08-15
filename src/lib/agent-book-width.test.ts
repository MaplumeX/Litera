// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_BOOK_WIDTH_DEFAULT,
  AGENT_BOOK_WIDTH_KEY,
  AGENT_BOOK_WIDTH_MAX,
  AGENT_BOOK_WIDTH_MIN,
  clampAgentBookWidth,
  loadAgentBookWidth,
  saveAgentBookWidth,
} from "./agent-book-width";

afterEach(() => {
  localStorage.removeItem(AGENT_BOOK_WIDTH_KEY);
  vi.restoreAllMocks();
});

describe("clampAgentBookWidth", () => {
  it("clamps to the minimum", () => {
    expect(clampAgentBookWidth(10)).toBe(AGENT_BOOK_WIDTH_MIN);
  });

  it("clamps to the maximum", () => {
    expect(clampAgentBookWidth(90)).toBe(AGENT_BOOK_WIDTH_MAX);
  });

  it("keeps in-range values and rounds", () => {
    expect(clampAgentBookWidth(38)).toBe(38);
    expect(clampAgentBookWidth(40.6)).toBe(41);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampAgentBookWidth(Number.NaN)).toBe(AGENT_BOOK_WIDTH_DEFAULT);
    expect(clampAgentBookWidth(Number.POSITIVE_INFINITY)).toBe(AGENT_BOOK_WIDTH_DEFAULT);
  });
});

describe("loadAgentBookWidth", () => {
  it("returns the default when nothing is saved", () => {
    expect(loadAgentBookWidth()).toBe(AGENT_BOOK_WIDTH_DEFAULT);
  });

  it("reads a saved width", () => {
    localStorage.setItem(AGENT_BOOK_WIDTH_KEY, "45");
    expect(loadAgentBookWidth()).toBe(45);
  });

  it("ignores invalid values", () => {
    localStorage.setItem(AGENT_BOOK_WIDTH_KEY, "abc");
    expect(loadAgentBookWidth()).toBe(AGENT_BOOK_WIDTH_DEFAULT);
    localStorage.setItem(AGENT_BOOK_WIDTH_KEY, "10");
    expect(loadAgentBookWidth()).toBe(AGENT_BOOK_WIDTH_DEFAULT);
  });
});

describe("saveAgentBookWidth", () => {
  it("persists the width and round-trips through load", () => {
    saveAgentBookWidth(45);
    expect(localStorage.getItem(AGENT_BOOK_WIDTH_KEY)).toBe("45");
    expect(loadAgentBookWidth()).toBe(45);
  });
});
