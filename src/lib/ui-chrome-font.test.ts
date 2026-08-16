// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UI_FONT_FAMILY,
  DEFAULT_UI_FONT_SIZE,
  UI_FONT_FAMILY_KEY,
  UI_FONT_SIZE_KEY,
  applyUiChrome,
  chromeFontStack,
  loadUiFontFamily,
  loadUiFontSize,
  parseUiFontFamily,
  parseUiFontSize,
  saveUiFontFamily,
  saveUiFontSize,
} from "./ui-chrome-font";

afterEach(() => {
  localStorage.removeItem(UI_FONT_SIZE_KEY);
  localStorage.removeItem(UI_FONT_FAMILY_KEY);
  document.documentElement.style.fontSize = "";
  document.documentElement.style.removeProperty("--font-sans");
  vi.restoreAllMocks();
});

describe("parseUiFontSize", () => {
  it("defaults when missing or not a finite number", () => {
    expect(parseUiFontSize(undefined)).toBe(DEFAULT_UI_FONT_SIZE);
    expect(parseUiFontSize(null)).toBe(DEFAULT_UI_FONT_SIZE);
    expect(parseUiFontSize("")).toBe(DEFAULT_UI_FONT_SIZE);
    expect(parseUiFontSize("abc")).toBe(DEFAULT_UI_FONT_SIZE);
    expect(parseUiFontSize(Number.NaN)).toBe(DEFAULT_UI_FONT_SIZE);
  });

  it("clamps to 12–20 and rounds to an integer", () => {
    expect(parseUiFontSize("12")).toBe(12);
    expect(parseUiFontSize(20)).toBe(20);
    expect(parseUiFontSize("16.4")).toBe(16);
    expect(parseUiFontSize(16.6)).toBe(17);
    expect(parseUiFontSize(11)).toBe(12);
    expect(parseUiFontSize("21")).toBe(20);
  });
});

describe("parseUiFontFamily", () => {
  it("defaults empty or invalid names to Geist", () => {
    expect(parseUiFontFamily(undefined)).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(parseUiFontFamily("")).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(parseUiFontFamily("   ")).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(parseUiFontFamily("bad;font")).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(parseUiFontFamily("has{brace}")).toBe(DEFAULT_UI_FONT_FAMILY);
  });

  it("keeps a valid named or generic family", () => {
    expect(parseUiFontFamily("serif")).toBe("serif");
    expect(parseUiFontFamily("  Noto Sans CJK SC  ")).toBe("Noto Sans CJK SC");
    expect(parseUiFontFamily(DEFAULT_UI_FONT_FAMILY)).toBe(DEFAULT_UI_FONT_FAMILY);
  });
});

describe("load / save", () => {
  it("returns defaults when nothing is saved", () => {
    expect(loadUiFontSize()).toBe(DEFAULT_UI_FONT_SIZE);
    expect(loadUiFontFamily()).toBe(DEFAULT_UI_FONT_FAMILY);
  });

  it("round-trips valid values", () => {
    saveUiFontSize(18);
    saveUiFontFamily("Source Han Sans");
    expect(localStorage.getItem(UI_FONT_SIZE_KEY)).toBe("18");
    expect(localStorage.getItem(UI_FONT_FAMILY_KEY)).toBe("Source Han Sans");
    expect(loadUiFontSize()).toBe(18);
    expect(loadUiFontFamily()).toBe("Source Han Sans");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(UI_FONT_SIZE_KEY, "huge");
    localStorage.setItem(UI_FONT_FAMILY_KEY, "evil;font");
    expect(loadUiFontSize()).toBe(DEFAULT_UI_FONT_SIZE);
    expect(loadUiFontFamily()).toBe(DEFAULT_UI_FONT_FAMILY);
  });

  it("swallows quota errors on save", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveUiFontSize(14)).not.toThrow();
    expect(() => saveUiFontFamily("serif")).not.toThrow();
    setItem.mockRestore();
  });

  it("does not write preferences.json keys", () => {
    saveUiFontSize(14);
    saveUiFontFamily("serif");
    expect(localStorage.getItem("preferences")).toBeNull();
    expect(Object.keys(localStorage)).toEqual(
      expect.arrayContaining([UI_FONT_SIZE_KEY, UI_FONT_FAMILY_KEY]),
    );
  });
});

describe("chromeFontStack", () => {
  it("keeps today's Geist + CJK stack for the default face", () => {
    expect(chromeFontStack(DEFAULT_UI_FONT_FAMILY)).toBe(
      '"Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
    );
  });

  it("quotes a named face and appends CJK fallbacks without duplicating it", () => {
    expect(chromeFontStack("Source Han Sans")).toBe(
      '"Source Han Sans", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
    );
    expect(chromeFontStack("PingFang SC")).toBe(
      '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
    );
  });

  it("puts a generic first and skips it in the fallback list", () => {
    expect(chromeFontStack("sans-serif")).toBe(
      'sans-serif, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui',
    );
  });
});

describe("applyUiChrome", () => {
  it("sets html font-size and --font-sans", () => {
    applyUiChrome(18, "Source Han Sans");
    expect(document.documentElement.style.fontSize).toBe("18px");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(
      chromeFontStack("Source Han Sans"),
    );
  });

  it("clamps invalid values before writing the DOM", () => {
    applyUiChrome(99, "bad;font");
    expect(document.documentElement.style.fontSize).toBe("20px");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(
      chromeFontStack(DEFAULT_UI_FONT_FAMILY),
    );
  });
});
