// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/locales/en";
import { zhCN, type MessageKey } from "@/locales/zh-CN";
import {
  detectLocale,
  getLocale,
  initLocale,
  LOCALE_STORAGE_KEY,
  setLocale,
  t,
} from "./i18n";

afterEach(() => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  setLocale("zh-CN");
  vi.restoreAllMocks();
});

describe("detectLocale", () => {
  it("maps zh* tags to zh-CN", () => {
    expect(detectLocale(["zh"])).toBe("zh-CN");
    expect(detectLocale(["zh-CN"])).toBe("zh-CN");
    expect(detectLocale(["zh-TW"])).toBe("zh-CN");
    expect(detectLocale(["zh-HK", "en"])).toBe("zh-CN");
  });

  it("maps non-zh tags to en", () => {
    expect(detectLocale(["en-US"])).toBe("en");
    expect(detectLocale(["ja-JP"])).toBe("en");
    expect(detectLocale(["en-US", "fr-FR"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});

describe("persistence", () => {
  it("writes setLocale to localStorage and document.lang", () => {
    setLocale("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("initLocale uses a stored locale", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(initLocale()).toBe("en");
    expect(getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("initLocale ignores invalid stored values and persists the OS locale", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-TW");
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-TW"]);
    expect(initLocale()).toBe("zh-CN");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
  });

  it("initLocale detects and persists when unset", () => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["en-US"]);
    expect(initLocale()).toBe("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });
});

describe("t", () => {
  it("interpolates {name} placeholders", () => {
    setLocale("zh-CN");
    expect(t("library.alreadyInLibrary", { title: "Foo" })).toBe("《Foo》已在书库");
    setLocale("en");
    expect(t("library.alreadyInLibrary", { title: "Foo" })).toBe("“Foo” is already in the library");
  });

  it("returns the key and warns in dev when missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("no.such.key" as MessageKey)).toBe("no.such.key");
    expect(warn).toHaveBeenCalled();
  });
});

describe("catalogs", () => {
  it("has the same keys in zh-CN and en", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });
});
