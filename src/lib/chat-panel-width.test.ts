// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_PANEL_WIDTH_DEFAULT,
  CHAT_PANEL_WIDTH_KEY,
  CHAT_PANEL_WIDTH_MAX,
  CHAT_PANEL_WIDTH_MIN,
  clampChatPanelWidth,
  loadChatPanelWidth,
  saveChatPanelWidth,
} from "./chat-panel-width";

afterEach(() => {
  localStorage.removeItem(CHAT_PANEL_WIDTH_KEY);
  localStorage.removeItem("react-resizable-panels:reader-chat");
  vi.restoreAllMocks();
});

describe("clampChatPanelWidth", () => {
  it("clamps to the minimum", () => {
    expect(clampChatPanelWidth(5)).toBe(CHAT_PANEL_WIDTH_MIN);
  });

  it("clamps to the maximum", () => {
    expect(clampChatPanelWidth(80)).toBe(CHAT_PANEL_WIDTH_MAX);
  });

  it("keeps in-range values and rounds", () => {
    expect(clampChatPanelWidth(22)).toBe(22);
    expect(clampChatPanelWidth(35.4)).toBe(35);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampChatPanelWidth(Number.NaN)).toBe(CHAT_PANEL_WIDTH_DEFAULT);
    expect(clampChatPanelWidth(Number.POSITIVE_INFINITY)).toBe(CHAT_PANEL_WIDTH_DEFAULT);
  });
});

describe("loadChatPanelWidth", () => {
  it("returns the default when nothing is saved", () => {
    expect(loadChatPanelWidth()).toBe(CHAT_PANEL_WIDTH_DEFAULT);
  });

  it("reads a saved width", () => {
    localStorage.setItem(CHAT_PANEL_WIDTH_KEY, "35");
    expect(loadChatPanelWidth()).toBe(35);
  });

  it("ignores invalid values", () => {
    localStorage.setItem(CHAT_PANEL_WIDTH_KEY, "abc");
    expect(loadChatPanelWidth()).toBe(CHAT_PANEL_WIDTH_DEFAULT);
    localStorage.setItem(CHAT_PANEL_WIDTH_KEY, "10");
    expect(loadChatPanelWidth()).toBe(CHAT_PANEL_WIDTH_DEFAULT);
  });

  it("migrates a legacy react-resizable-panels layout", () => {
    localStorage.setItem(
      "react-resizable-panels:reader-chat",
      JSON.stringify({ "reader,chat": { layout: [65, 35] } }),
    );
    expect(loadChatPanelWidth()).toBe(35);
  });

  it("prefers the new key over a legacy layout", () => {
    localStorage.setItem(CHAT_PANEL_WIDTH_KEY, "28");
    localStorage.setItem(
      "react-resizable-panels:reader-chat",
      JSON.stringify({ "reader,chat": { layout: [65, 35] } }),
    );
    expect(loadChatPanelWidth()).toBe(28);
  });
});

describe("saveChatPanelWidth", () => {
  it("persists the width and round-trips through load", () => {
    saveChatPanelWidth(35);
    expect(localStorage.getItem(CHAT_PANEL_WIDTH_KEY)).toBe("35");
    expect(loadChatPanelWidth()).toBe(35);
  });
});
