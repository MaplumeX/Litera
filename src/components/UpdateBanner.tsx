import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  canInstallInApp,
  dismissUpdate,
  installUpdate,
  useAppUpdate,
} from "@/lib/app-update";

/**
 * Announces a new release and carries its download and install. A card floating
 * just under the titlebar's right end on the desktop, so it never pushes the
 * titlebar down; a snackbar on the phone. `beforeRestart` flushes
 * unsaved reading state before the app restarts into the new version.
 */
export function UpdateBanner({
  variant = "card",
  beforeRestart,
}: {
  variant?: "card" | "snackbar";
  beforeRestart: () => Promise<void>;
}) {
  const { t } = useT();
  const update = useAppUpdate();
  const snackbar = variant === "snackbar";

  let message: string;
  let actions = false;
  switch (update.status) {
    case "available":
      if (update.dismissed) return null;
      message = update.error
        ? t("update.failed", { message: update.error })
        : t("update.available", { version: update.version });
      actions = true;
      break;
    case "downloading":
      message = t("update.downloading", { version: update.version });
      if (update.progress != null) message += ` ${Math.round(update.progress * 100)}%`;
      break;
    case "installing":
      message = t("update.installing");
      break;
    default:
      return null;
  }

  const ghost = snackbar ? "text-background hover:bg-background/10 hover:text-background" : undefined;
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 text-sm",
        snackbar
          ? "m-rise pointer-events-auto rounded-lg bg-foreground py-1.5 pr-1.5 pl-4 text-background shadow-float"
          : "m-rise fixed top-14 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-popover py-1.5 pr-1.5 pl-4 text-popover-foreground shadow-float",
      )}
    >
      <span className="min-w-0 flex-1 py-1.5">{message}</span>
      {actions && (
        <>
          <Button size="sm" variant="ghost" className={ghost} onClick={dismissUpdate}>
            {t("update.later")}
          </Button>
          <Button
            size="sm"
            variant={snackbar ? "secondary" : "default"}
            onClick={() => void installUpdate(beforeRestart)}
          >
            {canInstallInApp() ? t("update.install") : t("update.download")}
          </Button>
        </>
      )}
    </div>
  );
}
