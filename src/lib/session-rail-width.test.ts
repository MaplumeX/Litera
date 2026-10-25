// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clampSessionRailWidth,
  loadSessionRailWidth,
  saveSessionRailWidth,
  SESSION_RAIL_WIDTH_DEFAULT,
  SESSION_RAIL_WIDTH_KEY,
  SESSION_RAIL_WIDTH_MAX,
  SESSION_RAIL_WIDTH_MIN,
} from "./session-rail-width";

afterEach(() => {
  localStorage.removeItem(SESSION_RAIL_WIDTH_KEY);
});

describe("clampSessionRailWidth", () => {
  it("clamps to the minimum", () => {
    expect(clampSessionRailWidth(50)).toBe(SESSION_RAIL_WIDTH_MIN);
  });

  it("clamps to the hard maximum", () => {
    expect(clampSessionRailWidth(2000)).toBe(SESSION_RAIL_WIDTH_MAX);
  });

  it("clamps to a smaller container max", () => {
    expect(clampSessionRailWidth(400, 300)).toBe(300);
  });

  it("keeps in-range values and rounds", () => {
    expect(clampSessionRailWidth(300.6)).toBe(301);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampSessionRailWidth(Number.NaN)).toBe(SESSION_RAIL_WIDTH_DEFAULT);
  });

  it("uses the minimum as the upper bound when the container is tiny", () => {
    expect(clampSessionRailWidth(500, 50)).toBe(SESSION_RAIL_WIDTH_MIN);
  });
});

describe("loadSessionRailWidth", () => {
  it("returns the default when nothing is saved", () => {
    expect(loadSessionRailWidth()).toBe(SESSION_RAIL_WIDTH_DEFAULT);
  });

  it("ignores invalid values and clamps oversized ones", () => {
    localStorage.setItem(SESSION_RAIL_WIDTH_KEY, "abc");
    expect(loadSessionRailWidth()).toBe(SESSION_RAIL_WIDTH_DEFAULT);
    localStorage.setItem(SESSION_RAIL_WIDTH_KEY, "50");
    expect(loadSessionRailWidth()).toBe(SESSION_RAIL_WIDTH_DEFAULT);
    localStorage.setItem(SESSION_RAIL_WIDTH_KEY, "9999");
    expect(loadSessionRailWidth()).toBe(SESSION_RAIL_WIDTH_MAX);
  });
});

describe("saveSessionRailWidth", () => {
  it("round-trips through load", () => {
    saveSessionRailWidth(320);
    expect(localStorage.getItem(SESSION_RAIL_WIDTH_KEY)).toBe("320");
    expect(loadSessionRailWidth()).toBe(320);
  });
});
