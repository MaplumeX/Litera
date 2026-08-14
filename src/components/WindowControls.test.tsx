// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowApi = {
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

import {
  onTitlebarDragMouseDown,
  titlebarClassName,
  WindowControls,
} from "./WindowControls";

function mockUserAgent(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

beforeEach(() => {
  windowApi.minimize.mockClear();
  windowApi.toggleMaximize.mockClear();
  windowApi.close.mockClear();
  windowApi.destroy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WindowControls", () => {
  it("is hidden on macOS", () => {
    mockUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const { queryByRole } = render(<WindowControls />);
    expect(queryByRole("button", { name: "最小化" })).toBeNull();
    expect(queryByRole("button", { name: "最大化" })).toBeNull();
    expect(queryByRole("button", { name: "关闭窗口" })).toBeNull();
  });

  it("is visible on Windows and calls window commands", () => {
    mockUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const { getByRole } = render(<WindowControls />);
    fireEvent.click(getByRole("button", { name: "最小化" }));
    fireEvent.click(getByRole("button", { name: "最大化" }));
    fireEvent.click(getByRole("button", { name: "关闭窗口" }));
    expect(windowApi.minimize).toHaveBeenCalledTimes(1);
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowApi.close).toHaveBeenCalledTimes(1);
    expect(windowApi.destroy).not.toHaveBeenCalled();
  });

  it("is visible on Linux", () => {
    mockUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const { getByRole } = render(<WindowControls />);
    expect(getByRole("button", { name: "最小化" })).toBeTruthy();
    expect(getByRole("button", { name: "最大化" })).toBeTruthy();
    expect(getByRole("button", { name: "关闭窗口" })).toBeTruthy();
  });
});

describe("titlebar helpers", () => {
  it("insets the macOS header for traffic lights", () => {
    mockUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    );
    expect(titlebarClassName()).toContain("h-12");
    expect(titlebarClassName()).toContain("pl-[72px]");
  });

  it("keeps default horizontal padding off macOS", () => {
    mockUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
    );
    expect(titlebarClassName()).toContain("px-4");
    expect(titlebarClassName()).not.toContain("pl-[72px]");
  });

  it("toggles maximize on a primary double-click", () => {
    const event = {
      buttons: 1,
      detail: 2,
      preventDefault: vi.fn(),
    } as unknown as Parameters<typeof onTitlebarDragMouseDown>[0];
    onTitlebarDragMouseDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("does not toggle maximize on a single click", () => {
    const event = {
      buttons: 1,
      detail: 1,
      preventDefault: vi.fn(),
    } as unknown as Parameters<typeof onTitlebarDragMouseDown>[0];
    onTitlebarDragMouseDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(windowApi.toggleMaximize).not.toHaveBeenCalled();
  });
});
