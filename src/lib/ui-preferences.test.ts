// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  CHAT_FONT_FAMILY_KEY,
  CHAT_FONT_FOLLOWS_UI,
  DEFAULT_UI_FONT_FAMILY,
  DEFAULT_UI_FONT_SIZE,
  UI_FONT_FAMILY_KEY,
  UI_FONT_SIZE_KEY,
  chromeFontStack,
  loadChatFontFamily,
  loadUiFontFamily,
  loadUiFontSize,
  saveChatFontFamily,
  saveUiFontFamily,
  saveUiFontSize,
} from "@/lib/ui-chrome-font";
import { DEFAULT_UI_ACCENT, UI_ACCENT_KEY, loadUiAccent, saveUiAccent } from "@/lib/ui-accent";
import {
  flushUiPreferences,
  hydrateUiPreferences,
  subscribeUiPreferences,
} from "@/lib/ui-preferences";
import { resetUiPreferencesForTests } from "@/lib/ui-preferences-store";

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.fontSize = "";
  document.documentElement.style.removeProperty("--font-sans");
  document.documentElement.style.removeProperty("--font-chat");
  delete document.documentElement.dataset.accent;
  resetUiPreferencesForTests();
  invokeMock.mockReset();
});

describe("ui preferences disk persistence", () => {
  it("writes chat font, interface font, size, and accent to Rust storage", async () => {
    invokeMock.mockResolvedValue(undefined);

    saveChatFontFamily("LXGW WenKai");
    await flushUiPreferences();
    expect(invokeMock).toHaveBeenCalledWith("save_ui_preferences", {
      chatFontFamily: "LXGW WenKai",
    });

    invokeMock.mockClear();
    saveChatFontFamily(CHAT_FONT_FOLLOWS_UI);
    await flushUiPreferences();
    expect(invokeMock).toHaveBeenCalledWith("save_ui_preferences", {
      chatFontFamily: "",
    });

    invokeMock.mockClear();
    saveUiFontFamily("Noto Sans CJK SC");
    saveUiFontSize(18);
    saveUiAccent("pine");
    await flushUiPreferences();

    const merged = Object.assign(
      {},
      ...invokeMock.mock.calls
        .filter((call) => call[0] === "save_ui_preferences")
        .map((call) => call[1] as Record<string, unknown>),
    );
    expect(merged).toEqual({
      uiFontFamily: "Noto Sans CJK SC",
      uiFontSize: 18,
      uiAccent: "pine",
    });
  });

  it("coalesces rapid updates while a write is in flight", async () => {
    let releaseFirst!: () => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    invokeMock.mockResolvedValue(undefined);

    saveUiFontSize(17);
    saveUiFontSize(18);
    saveUiFontSize(19);
    saveChatFontFamily("LXGW WenKai");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "save_ui_preferences", { uiFontSize: 17 });

    releaseFirst();
    await flushUiPreferences();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ui_preferences", {
      uiFontSize: 19,
      chatFontFamily: "LXGW WenKai",
    });
  });

  it("restores chat font and chrome preferences from disk when localStorage was lost", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_ui_preferences") {
        return Promise.resolve({
          uiFontSize: 18,
          uiFontFamily: "Source Han Sans",
          chatFontFamily: "LXGW WenKai",
          uiAccent: "violet",
        });
      }
      return Promise.resolve(undefined);
    });

    const listener = vi.fn();
    const unsubscribe = subscribeUiPreferences(listener);
    await hydrateUiPreferences();
    unsubscribe();

    expect(loadUiFontSize()).toBe(18);
    expect(loadUiFontFamily()).toBe("Source Han Sans");
    expect(loadChatFontFamily()).toBe("LXGW WenKai");
    expect(loadUiAccent()).toBe("violet");
    expect(localStorage.getItem(CHAT_FONT_FAMILY_KEY)).toBe("LXGW WenKai");
    expect(document.documentElement.style.fontSize).toBe("18px");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(
      chromeFontStack("Source Han Sans"),
    );
    expect(document.documentElement.style.getPropertyValue("--font-chat")).toBe(
      chromeFontStack("LXGW WenKai"),
    );
    expect(document.documentElement.dataset.accent).toBe("violet");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("applies an explicit follow-interface chat font reset from disk over stale localStorage", async () => {
    localStorage.setItem(CHAT_FONT_FAMILY_KEY, "LXGW WenKai");
    document.documentElement.style.setProperty("--font-chat", chromeFontStack("LXGW WenKai"));
    invokeMock.mockResolvedValue({ chatFontFamily: "" });

    await hydrateUiPreferences();

    expect(loadChatFontFamily()).toBe(CHAT_FONT_FOLLOWS_UI);
    expect(localStorage.getItem(CHAT_FONT_FAMILY_KEY)).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--font-chat")).toBe("");
  });

  it("migrates existing localStorage preferences to disk on first run without ui-preferences.json", async () => {
    localStorage.setItem(UI_FONT_SIZE_KEY, "17");
    localStorage.setItem(UI_FONT_FAMILY_KEY, "Noto Sans CJK SC");
    localStorage.setItem(CHAT_FONT_FAMILY_KEY, "LXGW WenKai");
    localStorage.setItem(UI_ACCENT_KEY, "amber");

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_ui_preferences") return Promise.resolve(null);
      return Promise.resolve(undefined);
    });

    await hydrateUiPreferences();
    await flushUiPreferences();

    expect(invokeMock).toHaveBeenCalledWith("save_ui_preferences", {
      uiFontSize: 17,
      uiFontFamily: "Noto Sans CJK SC",
      chatFontFamily: "LXGW WenKai",
      uiAccent: "amber",
    });
  });

  it("does not overwrite a setting the user changed while hydration was in flight", async () => {
    let resolveDisk!: (value: unknown) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_ui_preferences") {
        return new Promise((resolve) => {
          resolveDisk = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const hydrating = hydrateUiPreferences();
    saveChatFontFamily("Source Han Serif");

    resolveDisk({
      chatFontFamily: "LXGW WenKai",
      uiFontSize: 18,
    });
    await hydrating;
    await flushUiPreferences();

    expect(loadChatFontFamily()).toBe("Source Han Serif");
    expect(loadUiFontSize()).toBe(18);
    expect(loadUiFontFamily()).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(loadUiAccent()).toBe(DEFAULT_UI_ACCENT);
  });

  it("does not write anything on a fresh install with no saved settings", async () => {
    invokeMock.mockResolvedValue(null);

    await hydrateUiPreferences();
    await flushUiPreferences();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_ui_preferences");
    expect(loadUiFontSize()).toBe(DEFAULT_UI_FONT_SIZE);
  });
});
