import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import {
  canInstallInApp,
  checkForUpdates,
  installUpdate,
  useAppUpdate,
  useAutoCheckUpdates,
} from "@/lib/app-update";

/** Settings › About: the automatic-check switch, a manual check, and its result. */
export function UpdateSettings({ beforeRestart }: { beforeRestart: () => Promise<void> }) {
  const { t } = useT();
  const update = useAppUpdate();
  const [autoCheck, setAutoCheck] = useAutoCheckUpdates();
  const busy =
    update.status === "checking" || update.status === "downloading" || update.status === "installing";

  let status: string | null = null;
  switch (update.status) {
    case "checking":
      status = t("settings.about.checking");
      break;
    case "upToDate":
      status = t("settings.about.upToDate");
      break;
    case "error":
      status = t("settings.about.checkFailed", { message: update.message });
      break;
    case "available":
      status = update.error
        ? t("update.failed", { message: update.error })
        : t("update.available", { version: update.version });
      break;
    case "downloading":
      status = t("update.downloading", { version: update.version });
      if (update.progress != null) status += ` ${Math.round(update.progress * 100)}%`;
      break;
    case "installing":
      status = t("update.installing");
      break;
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{t("settings.about.autoCheck")}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("settings.about.autoCheckHint")}
          </span>
        </span>
        <Switch className="mt-0.5" checked={autoCheck} onCheckedChange={setAutoCheck} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {update.status === "available" ? (
          <Button type="button" size="sm" onClick={() => void installUpdate(beforeRestart)}>
            {canInstallInApp() ? t("update.install") : t("update.download")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void checkForUpdates({ manual: true })}
          >
            {t("settings.about.check")}
          </Button>
        )}
        {status && (
          <span role="status" className="text-xs text-muted-foreground">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
