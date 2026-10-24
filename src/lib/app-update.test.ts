// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const checkMock = vi.fn();
const relaunchMock = vi.fn();
const fetchMock = vi.fn();
const openUrlMock = vi.fn();
const getVersionMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args: unknown[]) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunchMock() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrlMock(url) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersionMock() }));

const androidMock = vi.fn(() => false);
vi.mock("@/lib/platform", () => ({ isAndroid: () => androidMock() }));

import {
  AUTO_CHECK_UPDATES_KEY,
  LAST_UPDATE_CHECK_KEY,
  RELEASES_URL,
  UPDATE_CHECK_INTERVAL_MS,
  checkForUpdates,
  dismissUpdate,
  installUpdate,
  isNewerVersion,
  isUpdateCheckDue,
  loadAutoCheckUpdates,
  resetAppUpdateForTests,
  saveAutoCheckUpdates,
  useAppUpdate,
  useAutoUpdateCheck,
} from "@/lib/app-update";

function fakeUpdate(version: string) {
  return {
    version,
    close: vi.fn().mockResolvedValue(undefined),
    download: vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished" });
    }),
    install: vi.fn().mockResolvedValue(undefined),
  };
}

function currentState() {
  return renderHook(() => useAppUpdate()).result.current;
}

beforeEach(() => {
  localStorage.clear();
  resetAppUpdateForTests();
  vi.clearAllMocks();
  androidMock.mockReturnValue(false);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isNewerVersion", () => {
  it("compares major, minor and patch numerically", () => {
    expect(isNewerVersion("0.7.0", "0.6.0")).toBe(true);
    expect(isNewerVersion("0.6.10", "0.6.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.6.0", "0.6.0")).toBe(false);
    expect(isNewerVersion("0.5.9", "0.6.0")).toBe(false);
  });

  it("accepts a v prefix and rejects unparsable versions", () => {
    expect(isNewerVersion("v0.7.0", "0.6.0")).toBe(true);
    expect(isNewerVersion("latest", "0.6.0")).toBe(false);
  });
});

describe("isUpdateCheckDue", () => {
  const now = 10 * UPDATE_CHECK_INTERVAL_MS;
  it("is due when never checked or a day has passed", () => {
    expect(isUpdateCheckDue(null, now)).toBe(true);
    expect(isUpdateCheckDue(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
    expect(isUpdateCheckDue(now - 1000, now)).toBe(false);
  });

  it("is due when the clock went backwards", () => {
    expect(isUpdateCheckDue(now + 1000, now)).toBe(true);
  });
});

describe("auto-check preference", () => {
  it("defaults to on and persists", () => {
    expect(loadAutoCheckUpdates()).toBe(true);
    saveAutoCheckUpdates(false);
    expect(localStorage.getItem(AUTO_CHECK_UPDATES_KEY)).toBe("false");
    expect(loadAutoCheckUpdates()).toBe(false);
  });
});

describe("checkForUpdates (desktop)", () => {
  it("reports an available release and records the check", async () => {
    checkMock.mockResolvedValue(fakeUpdate("0.7.0"));
    await checkForUpdates();
    expect(currentState()).toEqual({ status: "available", version: "0.7.0", dismissed: false });
    expect(localStorage.getItem(LAST_UPDATE_CHECK_KEY)).not.toBeNull();
  });

  it("says up to date only for a manual check", async () => {
    checkMock.mockResolvedValue(null);
    await checkForUpdates();
    expect(currentState()).toEqual({ status: "idle" });
    await checkForUpdates({ manual: true });
    expect(currentState()).toEqual({ status: "upToDate" });
  });

  it("fails silently when automatic, visibly when manual", async () => {
    checkMock.mockRejectedValue(new Error("offline"));
    await checkForUpdates();
    expect(currentState()).toEqual({ status: "idle" });
    expect(localStorage.getItem(LAST_UPDATE_CHECK_KEY)).toBeNull();
    await checkForUpdates({ manual: true });
    expect(currentState()).toEqual({ status: "error", message: "offline" });
  });

  it("hides a dismissed release from the banner until checked manually", async () => {
    checkMock.mockImplementation(async () => fakeUpdate("0.7.0"));
    await checkForUpdates();
    dismissUpdate();
    await checkForUpdates();
    expect(currentState()).toMatchObject({ status: "available", dismissed: true });
    await checkForUpdates({ manual: true });
    expect(currentState()).toMatchObject({ status: "available", dismissed: false });
  });
});

describe("installUpdate (desktop)", () => {
  it("downloads, flushes, installs, then restarts", async () => {
    const update = fakeUpdate("0.7.0");
    checkMock.mockResolvedValue(update);
    await checkForUpdates();
    const order: string[] = [];
    update.install.mockImplementation(async () => void order.push("install"));
    relaunchMock.mockImplementation(async () => void order.push("relaunch"));
    await installUpdate(async () => void order.push("flush"));
    expect(update.download).toHaveBeenCalled();
    expect(order).toEqual(["flush", "install", "relaunch"]);
  });

  it("does not install when flushing fails, and offers a retry", async () => {
    const update = fakeUpdate("0.7.0");
    checkMock.mockResolvedValue(update);
    await checkForUpdates();
    await installUpdate(async () => {
      throw new Error("disk full");
    });
    expect(update.install).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(currentState()).toEqual({
      status: "available",
      version: "0.7.0",
      dismissed: false,
      error: "disk full",
    });
  });
});

describe("Android", () => {
  beforeEach(() => {
    androidMock.mockReturnValue(true);
    getVersionMock.mockResolvedValue("0.6.0");
  });

  it("reads the release manifest and never touches the updater", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: "v0.7.0" }) });
    await checkForUpdates();
    expect(checkMock).not.toHaveBeenCalled();
    expect(currentState()).toEqual({ status: "available", version: "0.7.0", dismissed: false });
  });

  it("is up to date when the manifest is not newer", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: "0.6.0" }) });
    await checkForUpdates({ manual: true });
    expect(currentState()).toEqual({ status: "upToDate" });
  });

  it("opens the Releases page instead of installing", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: "0.7.0" }) });
    openUrlMock.mockResolvedValue(undefined);
    await checkForUpdates();
    const flush = vi.fn();
    await installUpdate(flush);
    expect(openUrlMock).toHaveBeenCalledWith(RELEASES_URL);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("useAutoUpdateCheck", () => {
  it("checks shortly after startup when enabled and due", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    renderHook(() => useAutoUpdateCheck());
    expect(checkMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("skips when turned off or checked within the day", async () => {
    vi.useFakeTimers();
    saveAutoCheckUpdates(false);
    renderHook(() => useAutoUpdateCheck());
    saveAutoCheckUpdates(true);
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
    renderHook(() => useAutoUpdateCheck());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(checkMock).not.toHaveBeenCalled();
  });
});
