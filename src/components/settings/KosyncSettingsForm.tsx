import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invokeErrorMessage } from "@/lib/app-error";
import { useT } from "@/lib/i18n";

export interface KosyncConfigPublic {
  enabled: boolean;
  serverUrl: string;
  username: string;
  hasKey: boolean;
  deviceId: string;
}

interface KosyncStatus {
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

interface KosyncConfigDraft {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
}

const EMPTY_DRAFT: KosyncConfigDraft = {
  enabled: false,
  serverUrl: "",
  username: "",
  password: "",
};

/** KOReader Sync: a kosync-compatible Progress Server (KOReader, BookOrbit, …). */
export function KosyncSettingsForm() {
  const { t } = useT();
  const [draft, setDraft] = useState<KosyncConfigDraft>(EMPTY_DRAFT);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [status, setStatus] = useState<KosyncStatus>({});

  useEffect(() => {
    let disposed = false;
    void invoke<KosyncConfigPublic | null>("get_kosync_config")
      .then((config) => {
        if (disposed || !config) return;
        setDraft({
          enabled: config.enabled,
          serverUrl: config.serverUrl,
          username: config.username,
          password: "",
        });
        setHasStoredKey(config.hasKey);
      })
      .catch((error) => console.error("Failed to load KOReader Sync config:", error))
      .finally(() => {
        if (!disposed) setLoaded(true);
      });
    void invoke<KosyncStatus>("get_kosync_status")
      .then((next) => {
        if (!disposed && next) setStatus(next);
      })
      .catch(() => {
        // Status display is best-effort.
      });
    return () => {
      disposed = true;
    };
  }, []);

  function patch(next: Partial<KosyncConfigDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const config = await invoke<KosyncConfigPublic>("save_kosync_config", { config: draft });
      setHasStoredKey(config.hasKey);
      setDraft((current) => ({ ...current, password: "" }));
      setSaved(true);
    } catch (error) {
      setSaveError(invokeErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestSuccess(false);
    setTestError(null);
    try {
      await invoke("test_kosync_connection", { config: draft });
      setTestSuccess(true);
    } catch (error) {
      setTestError(invokeErrorMessage(error));
    } finally {
      setTesting(false);
    }
  }

  const fieldClass = "h-8 w-full";
  const segment = (active: boolean) =>
    active
      ? "rounded-sm border border-border bg-background px-3 py-1 text-xs"
      : "rounded-sm border border-transparent px-3 py-1 text-xs text-muted-foreground";

  return (
    <div className="max-w-md space-y-5">
      <div className="space-y-1">
        <div className="text-sm font-medium">{t("settings.kosync.title")}</div>
        <p className="text-xs text-muted-foreground">{t("settings.kosync.description")}</p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t("settings.kosync.enable")}
        </div>
        <div className="inline-flex rounded-md bg-muted p-0.5">
          <button
            type="button"
            role="radio"
            aria-checked={!draft.enabled}
            onClick={() => patch({ enabled: false })}
            className={segment(!draft.enabled)}
          >
            {t("settings.override.off")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={draft.enabled}
            onClick={() => patch({ enabled: true })}
            className={segment(draft.enabled)}
          >
            {t("settings.override.on")}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.kosync.serverUrl")}
          </span>
          <Input
            aria-label={t("settings.kosync.serverUrl")}
            className={fieldClass}
            value={draft.serverUrl}
            onChange={(event) => patch({ serverUrl: event.target.value })}
            placeholder="https://sync.koreader.rocks"
          />
          <span className="block text-[11px] text-muted-foreground/80">
            {t("settings.kosync.serverUrl.hint")}
          </span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.kosync.username")}
          </span>
          <Input
            aria-label={t("settings.kosync.username")}
            className={fieldClass}
            value={draft.username}
            onChange={(event) => patch({ username: event.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.kosync.password")}
          </span>
          <Input
            aria-label={t("settings.kosync.password")}
            className={fieldClass}
            type="password"
            value={draft.password}
            onChange={(event) => patch({ password: event.target.value })}
          />
          {loaded && hasStoredKey && !draft.password && (
            <span className="block text-[11px] text-muted-foreground">
              {t("settings.kosync.password.configured")}
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
        {saved && <span className="text-xs text-muted-foreground">{t("settings.sync.saved")}</span>}
      </div>

      {testSuccess && (
        <p className="text-xs text-green-600 dark:text-green-400">
          {t("settings.sync.test.success")}
        </p>
      )}
      {testError && <p className="text-xs text-destructive">{testError}</p>}
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <div className="text-xs text-muted-foreground">
        <div>
          {status.lastSyncedAt
            ? t("settings.kosync.status.lastRun", { time: status.lastSyncedAt })
            : t("settings.kosync.status.never")}
        </div>
        {status.lastError && (
          <div>{t("settings.sync.status.error", { message: status.lastError })}</div>
        )}
      </div>
    </div>
  );
}
