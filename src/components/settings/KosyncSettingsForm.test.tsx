// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KosyncSettingsForm } from "./KosyncSettingsForm";
import { setLocale } from "@/lib/i18n";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

const STORED = {
  enabled: true,
  serverUrl: "https://books.example.com/api/v1/koreader",
  username: "reader",
  hasKey: true,
  deviceId: "d",
};

function mockInvoke(overrides: Record<string, (args: unknown) => unknown> = {}) {
  invokeMock.mockImplementation((cmd: string, args: unknown) => {
    if (overrides[cmd]) return Promise.resolve().then(() => overrides[cmd](args));
    if (cmd === "get_kosync_config") return Promise.resolve(STORED);
    if (cmd === "get_kosync_status") return Promise.resolve({ lastSyncedAt: null, lastError: null });
    return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
  });
}

beforeEach(() => {
  setLocale("en");
  mockInvoke();
});

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
  invokeMock.mockReset();
});

describe("KosyncSettingsForm", () => {
  it("loads the stored configuration without ever showing the password", async () => {
    render(<KosyncSettingsForm />);

    await waitFor(() =>
      expect(screen.getByLabelText("Server URL")).toHaveProperty("value", STORED.serverUrl),
    );
    expect(screen.getByLabelText("Username")).toHaveProperty("value", "reader");
    expect(screen.getByLabelText("Password")).toHaveProperty("value", "");
    expect(screen.getByText("Configured — leave blank to keep")).toBeTruthy();
  });

  it("saves the draft and clears the typed password", async () => {
    const save = vi.fn(() => STORED);
    mockInvoke({ save_kosync_config: save });
    render(<KosyncSettingsForm />);
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveProperty("value", "reader"));

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(save).toHaveBeenCalledWith({
      config: {
        enabled: true,
        serverUrl: STORED.serverUrl,
        username: "reader",
        password: "hunter2",
      },
    });
    expect(screen.getByLabelText("Password")).toHaveProperty("value", "");
  });

  it("reports a failed connection test", async () => {
    mockInvoke({
      test_kosync_connection: () => {
        throw { code: "InvalidInput", message: "Invalid username or password" };
      },
    });
    render(<KosyncSettingsForm />);
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveProperty("value", "reader"));

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText("Invalid username or password")).toBeTruthy());
  });
});
