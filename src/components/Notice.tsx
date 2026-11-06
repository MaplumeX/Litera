import type { ReactNode } from "react";
import { CircleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Where notices float on the desktop: just under the titlebar's right end, over
 * the page rather than in its flow, so one appearing never moves the content.
 */
export function NoticeStack({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed top-14 right-4 z-40 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {children}
    </div>
  );
}

/**
 * One floating message: a card on the desktop, a snackbar on the phone.
 * Without `onDismiss` it stays until whatever raised it clears it.
 */
export function Notice({
  message,
  tone = "info",
  variant = "card",
  action,
  onDismiss,
}: {
  message: string;
  tone?: "info" | "error";
  variant?: "card" | "snackbar";
  action?: { label: string; disabled?: boolean; onClick: () => void };
  onDismiss?: () => void;
}) {
  const { t } = useT();
  const snackbar = variant === "snackbar";
  const ghost = snackbar ? "text-background hover:bg-background/10 hover:text-background" : undefined;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "m-rise pointer-events-auto flex items-center gap-2 rounded-xl py-1.5 pl-4 text-sm shadow-float",
        action || onDismiss ? "pr-1.5" : "pr-4",
        snackbar ? "bg-foreground text-background" : "bg-popover text-popover-foreground",
      )}
    >
      {tone === "error" && !snackbar && (
        <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      )}
      {/* Backend errors can carry whole paths: wrap them, and scroll past a few lines. */}
      <span className="max-h-40 min-w-0 flex-1 overflow-y-auto py-1.5 break-words">{message}</span>
      {action && (
        <Button size="sm" variant="ghost" className={ghost} disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {onDismiss &&
        (snackbar ? (
          <Button size="sm" variant="ghost" className={ghost} onClick={onDismiss}>
            {t("common.close")}
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={t("common.close")}
            onClick={onDismiss}
          >
            <X />
          </Button>
        ))}
    </div>
  );
}
