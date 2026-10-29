import type { ReactNode } from "react";
import { BookOpen, FastForward } from "lucide-react";

/**
 * Transcript marker for Continue or a picked guided step: where the reader
 * moved the guide on. They did not type it, so it is not shown as their message.
 */
export function GuideStepMarker({ label, skim, branchSwitcher }: { label: string; skim?: boolean; branchSwitcher?: ReactNode }) {
  const Icon = skim ? FastForward : BookOpen;
  return (
    <div data-testid="guide-step" className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="flex min-w-0 items-center gap-1">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      {branchSwitcher}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}
