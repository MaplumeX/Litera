import { BookOpen, FastForward, Play, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t as translate, useT } from "@/lib/i18n";
import type { GuideStep } from "@/types/agent";

function stepTitle(step: GuideStep): string {
  return step.chapterTitle ?? translate("chat.guide.chapterFallback", { number: step.chapterIndex + 1 });
}

/** The visible text of a guided step's user message. */
export function guideStepLabel(step: GuideStep): string {
  const title = stepTitle(step);
  if (step.skim) {
    return step.part > 0
      ? translate("chat.guide.skimLabelFrom", { title, from: step.part + 1, total: step.totalParts })
      : translate("chat.guide.skimLabel", { title });
  }
  return step.totalParts > 1
    ? translate("chat.guide.stepLabel", { title, part: step.part + 1, total: step.totalParts })
    : translate("chat.guide.stepLabelWhole", { title });
}

/** Where a Guided session stands, for the Session list. */
export function guidePositionLabel(step: GuideStep): string {
  if (step.skim) return translate("chat.guide.positionSkimmed", { title: stepTitle(step) });
  return step.totalParts > 1
    ? translate("chat.guide.position", { title: stepTitle(step), part: step.part + 1, total: step.totalParts })
    : stepTitle(step);
}

interface GuideBarProps {
  /** The next step; null at the end of the Book, undefined while unknown. */
  nextStep: GuideStep | null | undefined;
  started: boolean;
  disabled: boolean;
  onContinue: () => void;
  onSkim: () => void;
  onSkip: () => void;
}

/** Above the input of a Guided session: the one-tap ways to read on. */
export function GuideBar({ nextStep, started, disabled, onContinue, onSkim, onSkip }: GuideBarProps) {
  const { t } = useT();
  if (nextStep === undefined) return null;
  if (nextStep === null) {
    return (
      <p className="flex items-center justify-center gap-1.5 px-3 pt-1 text-xs text-muted-foreground" role="status">
        <BookOpen className="h-3.5 w-3.5" />
        {t("chat.guide.end")}
      </p>
    );
  }
  const title = stepTitle(nextStep);
  const label = !started
    ? t("chat.guide.start", { title })
    : nextStep.totalParts > 1
      ? t("chat.guide.continue", { title, part: nextStep.part + 1, total: nextStep.totalParts })
      : t("chat.guide.continueWhole", { title });
  return (
    <div className="flex items-center justify-center gap-1 px-2 pt-1">
      <Button
        size="sm"
        variant="secondary"
        className="min-w-0 rounded-full"
        onClick={onContinue}
        disabled={disabled}
        title={label}
      >
        <Play />
        <span className="truncate">{label}</span>
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0 rounded-full text-muted-foreground"
        onClick={onSkim}
        disabled={disabled}
        aria-label={t("chat.guide.skim")}
        title={t("chat.guide.skim")}
      >
        <FastForward />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0 rounded-full text-muted-foreground"
        onClick={onSkip}
        disabled={disabled}
        aria-label={t("chat.guide.skip")}
        title={t("chat.guide.skip")}
      >
        <SkipForward />
      </Button>
    </div>
  );
}
