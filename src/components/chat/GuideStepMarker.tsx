import type { ReactNode } from "react";
import { BookOpen, FastForward } from "lucide-react";
import type { GuideStep } from "@/types/agent";

/**
 * Transcript marker for a guided step: where a step of a Guided session
 * starts, and what it reads. The reader did not type it (Continue, the
 * picker or the assistant sent it), so it is not shown as their message.
 */
export function GuideStepMarker({ label, step, branchSwitcher }: { label: string; step: GuideStep; branchSwitcher?: ReactNode }) {
  const Icon = step.skim ? FastForward : BookOpen;
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
