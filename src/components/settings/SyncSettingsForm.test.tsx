// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSettingsForm } from "./SyncSettingsForm";
import { setLocale } from "@/lib/i18n";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

function renderForm() {
  return render(<SyncSettingsForm />);
}

beforeEach(() => {
  setLocale("en");
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_sync_config") {
      return Promise.resolve(null);
    }
    if (cmd === "get_sync_state") {
      return Promise.resolve({ lastSyncedAt: null, lastError: null });
    }
    return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
  });
});

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
  invokeMock.mockClear();
});

describe("SyncSettingsForm", () => {
  it("loads and renders the saved configuration with the secret never returned", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") {
        return Promise.resolve({
          schemaVersion: 1,
          endpoint: "https://s3.example.com",
          region: "us-east-1",
          bucket: "litera-books",
          pathStyle: true,
          accessKey: "AKIAEXAMPLE",
          secretKey: null,
          hasSecretKey: true,
          enabled: false,
        });
      }
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });

    renderForm();

    await waitFor(() => {
      expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe(
        "https://s3.example.com",
      );
    });
    expect((screen.getByLabelText("Region") as HTMLInputElement).value).toBe("us-east-1");
    expect((screen.getByLabelText("Bucket") as HTMLInputElement).value).toBe("litera-books");
    expect((screen.getByLabelText("Access key") as HTMLInputElement).value).toBe("AKIAEXAMPLE");
    // Secret is never echoed back; only a "configured" marker is shown.
    expect((screen.getByLabelText("Secret key") as HTMLInputElement).value).toBe("");
  });

  it("saves the configuration without touching the stored secret when the field is left blank", async () => {
    renderForm();
    await waitFor(() => {
      expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Endpoint"), {
      target: { value: "https://s3.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "us-east-1" } });
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "litera-books" } });
    fireEvent.change(screen.getByLabelText("Access key"), {
      target: { value: "AKIAEXAMPLE" },
    });
    // Leave secret blank: existing secret must be preserved on the Rust side.
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(([cmd]) => cmd === "save_sync_config");
      expect(call).toBeTruthy();
    });
    const [, args] = invokeMock.mock.calls.find(([cmd]) => cmd === "save_sync_config")!;
    expect(args).toMatchObject({
      config: {
        endpoint: "https://s3.example.com",
        region: "us-east-1",
        bucket: "litera-books",
        pathStyle: true,
        accessKey: "AKIAEXAMPLE",
        secretKey: "",
        enabled: false,
      },
    });
  });

  it("shows the plaintext disclosure when enabling sync", async () => {
    renderForm();
    await waitFor(() => {
      expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    });

    expect(screen.queryByText(/plaintext/i)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /on/i }));

    expect(screen.queryByText(/plaintext/i)).not.toBeNull();
  });

  it("reports a successful connection test", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") return Promise.resolve(null);
      if (cmd === "test_sync_connection") return Promise.resolve(null);
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });

    renderForm();
    await waitFor(() => {
      expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Endpoint"), {
      target: { value: "https://s3.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "us-east-1" } });
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "litera-books" } });
    fireEvent.change(screen.getByLabelText("Access key"), {
      target: { value: "AKIAEXAMPLE" },
    });
    fireEvent.change(screen.getByLabelText("Secret key"), {
      target: { value: "secret-example" },
    });

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/success/i)).toBeTruthy();
    });
    expect(invokeMock.mock.calls.find(([cmd]) => cmd === "test_sync_connection")).toBeTruthy();
  });

  it("reports a failed connection test with the error message", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") return Promise.resolve(null);
      if (cmd === "test_sync_connection") {
        return Promise.reject({ code: "StorageIo", message: "Sync backend connection failed: 403" });
      }
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });

    renderForm();
    await waitFor(() => {
      expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Endpoint"), {
      target: { value: "https://s3.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "us-east-1" } });
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "litera-books" } });
    fireEvent.change(screen.getByLabelText("Access key"), {
      target: { value: "AKIAEXAMPLE" },
    });
    fireEvent.change(screen.getByLabelText("Secret key"), {
      target: { value: "secret-example" },
    });

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/403/)).toBeTruthy();
    });
  });
});

describe("SyncSettingsForm — Sync now", () => {
  it("runs a full sync pass when Sync now is clicked and reports success", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") {
        return Promise.resolve({
          schemaVersion: 1,
          endpoint: "https://s3.example.com",
          region: "us-east-1",
          bucket: "litera-books",
          pathStyle: true,
          accessKey: "AKIAEXAMPLE",
          secretKey: null,
          hasSecretKey: true,
          enabled: true,
        });
      }
      if (cmd === "sync_estimate_upload") {
        return Promise.resolve({ bytes: 0, books: 0, confirmed: true });
      }
      if (cmd === "sync_export_local_manifest") {
        return Promise.resolve({
          schemaVersion: 1,
          books: {},
          tombstones: [],
          preferences: null,
          provider: null,
        });
      }
      if (cmd === "sync_download_manifest") {
        return Promise.resolve({
          etag: "etag-1",
          manifest: { schemaVersion: 1, books: {}, tombstones: [], preferences: null, provider: null },
        });
      }
      return Promise.resolve(null);
    });

    renderForm();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sync now/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(screen.getByText("Synced")).toBeTruthy();
    });
    const commands = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(commands).toContain("sync_export_local_manifest");
    expect(commands).toContain("sync_download_manifest");
    expect(commands).toContain("sync_apply_merged_manifest");
    expect(commands).toContain("sync_upload_manifest");
  });

  it("surfaces a sync failure in the settings area", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") {
        return Promise.resolve({
          schemaVersion: 1,
          endpoint: "https://s3.example.com",
          region: "us-east-1",
          bucket: "litera-books",
          pathStyle: true,
          accessKey: "AKIAEXAMPLE",
          secretKey: null,
          hasSecretKey: true,
          enabled: true,
        });
      }
      if (cmd === "sync_estimate_upload") {
        return Promise.resolve({ bytes: 0, books: 0, confirmed: true });
      }
      if (cmd === "sync_export_local_manifest") {
        return Promise.resolve({
          schemaVersion: 1,
          books: {},
          tombstones: [],
          preferences: null,
          provider: null,
        });
      }
      if (cmd === "sync_download_manifest") {
        return Promise.reject({
          code: "InvalidInput",
          message: "Sync is not configured",
        });
      }
      return Promise.resolve(null);
    });

    renderForm();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sync now/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(screen.getByText(/sync failed/i)).toBeTruthy();
    });
  });

  it("shows the last sync time and last error from sync state", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") {
        return Promise.resolve(null);
      }
      if (cmd === "get_sync_state") {
        return Promise.resolve({
          lastSyncedAt: "2026-06-01T12:00:00+00:00",
          lastError: "Sync backend error: connection reset",
        });
      }
      return Promise.resolve(null);
    });

    renderForm();
    await waitFor(() => {
      expect(screen.getByText(/last sync: 2026-06-01T12:00:00\+00:00/i)).toBeTruthy();
    });
    expect(screen.getByText(/last error: sync backend error: connection reset/i)).toBeTruthy();
  });

  it("shows an upload-size estimate before the first bulk upload and syncs only after confirmation", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") {
        return Promise.resolve({
          schemaVersion: 1,
          endpoint: "https://s3.example.com",
          region: "us-east-1",
          bucket: "litera-books",
          pathStyle: true,
          accessKey: "AKIAEXAMPLE",
          secretKey: null,
          hasSecretKey: true,
          enabled: true,
        });
      }
      if (cmd === "sync_estimate_upload") {
        return Promise.resolve({ bytes: 15 * 1024 * 1024, books: 3, confirmed: false });
      }
      if (cmd === "sync_export_local_manifest") {
        return Promise.resolve({
          schemaVersion: 1,
          books: {},
          tombstones: [],
          preferences: null,
          provider: null,
        });
      }
      if (cmd === "sync_download_manifest") {
        return Promise.resolve({
          etag: "etag-1",
          manifest: { schemaVersion: 1, books: {}, tombstones: [], preferences: null, provider: null },
        });
      }
      return Promise.resolve(null);
    });

    renderForm();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sync now/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(screen.getByText(/upload your library/i)).toBeTruthy();
    });
    expect(screen.getByText(/15 MB/)).toBeTruthy();
    // No sync pass ran yet — only the estimate.
    const before = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(before).not.toContain("sync_export_local_manifest");
    expect(before).not.toContain("sync_confirm_bulk_upload");

    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));

    await waitFor(() => {
      expect(screen.getByText("Synced")).toBeTruthy();
    });
    const commands = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(commands).toContain("sync_confirm_bulk_upload");
    expect(commands).toContain("sync_upload_book_files");
    expect(commands).toContain("sync_upload_manifest");
  });
});
