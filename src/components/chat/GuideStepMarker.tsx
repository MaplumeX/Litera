import { useState, type ReactNode } from "react";
import { BookOpen, FastForward } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Transcript marker for a guided step the assistant took (or, in Sessions
 * recorded before, one sent as the reader's message): what the guide covered,
 * and a way to its start in the Book.
 */
export function GuideStepMarker({
  label,
  skim,
  branchSwitcher,
  onOpen,
}: {
  label: string;
  skim?: boolean;
  branchSwitcher?: ReactNode;
  /** Reveal the step's start in the Book pane; false when it cannot be found. */
  onOpen?: () => Promise<boolean>;
}) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  const Icon = skim ? FastForward : BookOpen;
  return (
    <div data-testid="guide-step" className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="flex min-w-0 items-center gap-1">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      {onOpen && (
        <button
          type="button"
          disabled={failed}
          onClick={() => {
            onOpen().then((found) => setFailed(!found), () => setFailed(true));
          }}
          className="shrink-0 underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60"
        >
          {failed ? t("chat.process.locateFailed") : t("chat.citation.openInBook")}
        </button>
      )}
      {branchSwitcher}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}
