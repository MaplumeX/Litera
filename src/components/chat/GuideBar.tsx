import { BookOpen, FastForward, ListEnd, Play, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t as translate, useT } from "@/lib/i18n";
import type { GuidePosition, GuideStep } from "@/types/agent";
import type { MessageKey } from "@/locales/zh-CN";

function stepTitle(step: GuideStep): string {
  return step.chapterTitle ?? translate("chat.guide.chapterFallback", { number: step.chapterIndex + 1 });
}

export function positionTitle(position: { chapterIndex: number; chapterTitle?: string }): string {
  return position.chapterTitle ?? translate("chat.guide.chapterFallback", { number: position.chapterIndex + 1 });
}

/** The paragraphs `from` to `to` (1-based, as the reader counts them) of one chapter. */
export function paragraphsLabel(from: number, to: number): string {
  return from >= to
    ? translate("chat.guide.paragraph", { number: from })
    : translate("chat.guide.paragraphs", { from, to });
}

/** The paragraph the reader sees at one end of a range; a step recorded before it was kept counts blocks. */
function endParagraph(position: GuidePosition): number {
  return position.paragraph ?? position.block + 1;
}

/** A range step's label: its chapter and paragraphs, or the chapters it runs between. */
function rangeLabel(step: GuideStep, within: MessageKey, across: MessageKey): string | null {
  if (!step.range) return null;
  const { from, to } = step.range;
  return from.chapterIndex === to.chapterIndex
    ? translate(within, { title: positionTitle(from), where: paragraphsLabel(endParagraph(from), endParagraph(to)) })
    : translate(across, { from: positionTitle(from), to: positionTitle(to) });
}

/** The visible text of a guided step's user message. */
export function guideStepLabel(step: GuideStep): string {
  const range = step.skim
    ? rangeLabel(step, "chat.guide.skimRangeLabel", "chat.guide.skimRangeLabelAcross")
    : rangeLabel(step, "chat.guide.rangeLabel", "chat.guide.rangeLabelAcross");
  if (range) return range;
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
  if (step.range) {
    const { to } = step.range;
    return step.skim
      ? translate("chat.guide.positionSkimmed", { title: positionTitle(to) })
      : translate("chat.guide.positionBlock", { title: positionTitle(to), where: paragraphsLabel(endParagraph(to), endParagraph(to)) });
  }
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
  /** Open the "Read to…" picker. */
  onPick: () => void;
}

/** Above the input of a Guided session: the one-tap ways to read on. */
export function GuideBar({ nextStep, started, disabled, onContinue, onSkim, onSkip, onPick }: GuideBarProps) {
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
    : rangeLabel(nextStep, "chat.guide.continueRange", "chat.guide.continueRangeAcross")
      ?? (nextStep.totalParts > 1
      ? t("chat.guide.continue", { title, part: nextStep.part + 1, total: nextStep.totalParts })
        : t("chat.guide.continueWhole", { title }));
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
        onClick={onPick}
        disabled={disabled}
        aria-label={t("chat.guide.pick")}
        title={t("chat.guide.pick")}
      >
        <ListEnd />
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
