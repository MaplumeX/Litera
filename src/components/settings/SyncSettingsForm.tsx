import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invokeErrorMessage } from "@/lib/app-error";
import { useT } from "@/lib/i18n";
import { runSyncOnce } from "@/lib/sync-runner";

export interface SyncConfigPublic {
  schemaVersion: number;
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  accessKey: string;
  secretKey: string | null;
  hasSecretKey: boolean;
  enabled: boolean;
}

interface UploadEstimate {
  bytes: number;
  books: number;
  confirmed: boolean;
}

interface SyncBackendConfigDraft {
  schemaVersion: number;
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  accessKey: string;
  secretKey: string;
  enabled: boolean;
}

const EMPTY_DRAFT: SyncBackendConfigDraft = {
  schemaVersion: 1,
  endpoint: "",
  region: "",
  bucket: "",
  pathStyle: true,
  accessKey: "",
  secretKey: "",
  enabled: false,
};

export function SyncSettingsForm() {
  const { t } = useT();
  const [draft, setDraft] = useState<SyncBackendConfigDraft>(EMPTY_DRAFT);
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<UploadEstimate | null>(null);

  useEffect(() => {
    let disposed = false;
    void invoke<SyncConfigPublic | null>("get_sync_config")
      .then((config) => {
        if (disposed || !config) return;
        setDraft({
          schemaVersion: config.schemaVersion,
          endpoint: config.endpoint,
          region: config.region,
          bucket: config.bucket,
          pathStyle: config.pathStyle,
          accessKey: config.accessKey,
          secretKey: "",
          enabled: config.enabled,
        });
        setHasStoredSecret(config.hasSecretKey);
      })
      .catch((error) => {
        console.error("Failed to load sync config:", error);
      })
      .finally(() => {
        if (!disposed) setLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  function patch(next: Partial<SyncBackendConfigDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function save() {
    setSaving(true);
    setSavedAt(false);
    setSaveError(null);
    try {
      const saved = await invoke<SyncConfigPublic>("save_sync_config", { config: draft });
      setHasStoredSecret(saved.hasSecretKey);
      setDraft((current) => ({ ...current, secretKey: "" }));
      setSavedAt(true);
    } catch (error) {
      setSaveError(invokeErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestError(null);
    setTestSuccess(false);
    try {
      await invoke("test_sync_connection", { config: draft });
      setTestSuccess(true);
    } catch (error) {
      setTestError(invokeErrorMessage(error));
    } finally {
      setTesting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncedAt(false);
    setSyncError(null);
    setEstimate(null);
    try {
      // The first bulk upload of an existing library starts only after the
      // user sees and confirms the upload-size estimate.
      const pending = await invoke<UploadEstimate>("sync_estimate_upload");
      if (pending.books > 0 && !pending.confirmed) {
        setEstimate(pending);
        return;
      }
      await runSyncOnce({ uploadFiles: true });
      setSyncedAt(true);
    } catch (error) {
      setSyncError(invokeErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  }

  async function confirmUpload() {
    setSyncing(true);
    setSyncError(null);
    setEstimate(null);
    try {
      await invoke("sync_confirm_bulk_upload");
      await runSyncOnce({ uploadFiles: true });
      setSyncedAt(true);
    } catch (error) {
      setSyncError(invokeErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
  }

  const fieldClass = "h-8 w-full";

  return (
    <div className="max-w-md space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t("settings.sync.enable")}
        </div>
        <div className="inline-flex rounded-md bg-muted p-0.5">
          <button
            type="button"
            role="radio"
            aria-checked={!draft.enabled}
            onClick={() => patch({ enabled: false })}
            className={
              !draft.enabled
                ? "rounded-sm border border-border bg-background px-3 py-1 text-xs"
                : "rounded-sm border border-transparent px-3 py-1 text-xs text-muted-foreground"
            }
          >
            {t("settings.override.off")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={draft.enabled}
            onClick={() => patch({ enabled: true })}
            className={
              draft.enabled
                ? "rounded-sm border border-border bg-background px-3 py-1 text-xs"
                : "rounded-sm border border-transparent px-3 py-1 text-xs text-muted-foreground"
            }
          >
            {t("settings.override.on")}
          </button>
        </div>
      </div>

      {draft.enabled && (
        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          {t("settings.sync.plaintext")}
        </p>
      )}

      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.sync.endpoint")}
          </span>
          <Input
            aria-label={t("settings.sync.endpoint")}
            className={fieldClass}
            value={draft.endpoint}
            onChange={(event) => patch({ endpoint: event.target.value })}
            placeholder="https://s3.us-east-1.amazonaws.com"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.sync.region")}
          </span>
          <Input
            aria-label={t("settings.sync.region")}
            className={fieldClass}
            value={draft.region}
            onChange={(event) => patch({ region: event.target.value })}
            placeholder="us-east-1"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.sync.bucket")}
          </span>
          <Input
            aria-label={t("settings.sync.bucket")}
            className={fieldClass}
            value={draft.bucket}
            onChange={(event) => patch({ bucket: event.target.value })}
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">
              {t("settings.sync.pathStyle")}
            </div>
            <div className="text-[11px] text-muted-foreground/80">
              {t("settings.sync.pathStyle.hint")}
            </div>
          </div>
          <input
            type="checkbox"
            checked={draft.pathStyle}
            onChange={(event) => patch({ pathStyle: event.target.checked })}
            className="size-4 shrink-0"
          />
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.sync.accessKey")}
          </span>
          <Input
            aria-label={t("settings.sync.accessKey")}
            className={fieldClass}
            value={draft.accessKey}
            onChange={(event) => patch({ accessKey: event.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.sync.secretKey")}
          </span>
          <Input
            aria-label={t("settings.sync.secretKey")}
            className={fieldClass}
            type="password"
            value={draft.secretKey}
            onChange={(event) => patch({ secretKey: event.target.value })}
          />
          {loaded && hasStoredSecret && !draft.secretKey && (
            <span className="block text-[11px] text-muted-foreground">
              {t("settings.sync.secretKey.configured")}
            </span>
          )}
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? t("settings.sync.saving") : t("settings.sync.save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void testConnection()}
          disabled={testing}
        >
          {testing ? t("settings.sync.testing") : t("settings.sync.test")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void syncNow()}
          disabled={syncing || !draft.enabled}
        >
          {syncing ? t("settings.sync.running") : t("settings.sync.now")}
        </Button>
        {savedAt && (
          <span className="text-xs text-muted-foreground">{t("settings.sync.saved")}</span>
        )}
        {syncedAt && !syncing && (
          <span className="text-xs text-muted-foreground">{t("settings.sync.success")}</span>
        )}
      </div>

      {testSuccess && (
        <p className="text-xs text-green-600 dark:text-green-400">
          {t("settings.sync.test.success")}
        </p>
      )}
      {estimate && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs font-medium">
            {t("settings.sync.estimate.title")}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.sync.estimate.body", {
              size: formatBytes(estimate.bytes),
              count: estimate.books,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void confirmUpload()}>
              {t("settings.sync.estimate.confirm")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEstimate(null)}
            >
              {t("settings.sync.estimate.cancel")}
            </Button>
          </div>
        </div>
      )}
      {testError && <p className="text-xs text-destructive">{testError}</p>}
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      {syncError && (
        <p className="text-xs text-destructive">{t("settings.sync.failed", { message: syncError })}</p>
      )}
    </div>
  );
}
