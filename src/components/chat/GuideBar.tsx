import { useState } from "react";
import { BookOpen, FastForward, Layers, ListEnd, Play, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { t as translate, useT } from "@/lib/i18n";
import { isLegacyGuideStep, type GuideContextStats, type GuidePosition, type GuideStep, type RecordedGuideStep } from "@/types/agent";
import type { MessageKey } from "@/locales/zh-CN";

export function positionTitle(position: { chapterIndex: number; chapterTitle?: string }): string {
  return position.chapterTitle ?? translate("chat.guide.chapterFallback", { number: position.chapterIndex + 1 });
}

/** The paragraphs `from` to `to` (1-based, as the reader counts them) of one chapter. */
export function paragraphsLabel(from: number, to: number): string {
  return from >= to
    ? translate("chat.guide.paragraph", { number: from })
    : translate("chat.guide.paragraphs", { from, to });
}

/** The paragraph the reader sees at one end of a step; a step recorded before it was kept counts blocks. */
function endParagraph(position: GuidePosition): number {
  return position.paragraph ?? position.block + 1;
}

/**
 * A step that is a whole part of a chapter (a skim: that part to the
 * chapter's end), labelled by its part; null for any other range.
 */
function partOfStep(step: RecordedGuideStep): { title: string; index: number; total: number } | null {
  if (isLegacyGuideStep(step)) return { title: positionTitle(step), index: step.part, total: step.totalParts };
  return step.part ? { title: positionTitle(step.from), ...step.part } : null;
}

/** A range step's label: its chapter and paragraphs, or the chapters it runs between. */
function rangeLabel(step: GuideStep, within: MessageKey, across: MessageKey): string {
  const { from, to } = step;
  return from.chapterIndex === to.chapterIndex
    ? translate(within, { title: positionTitle(from), where: paragraphsLabel(endParagraph(from), endParagraph(to)) })
    : translate(across, { from: positionTitle(from), to: positionTitle(to) });
}

/** The visible text of a guided step's user message. */
export function guideStepLabel(step: RecordedGuideStep): string {
  const part = partOfStep(step);
  if (!part) {
    const range = step as GuideStep;
    return range.skim
      ? rangeLabel(range, "chat.guide.skimRangeLabel", "chat.guide.skimRangeLabelAcross")
      : rangeLabel(range, "chat.guide.rangeLabel", "chat.guide.rangeLabelAcross");
  }
  const { title, index, total } = part;
  if (step.skim) {
    return index > 0
      ? translate("chat.guide.skimLabelFrom", { title, from: index + 1, total })
      : translate("chat.guide.skimLabel", { title });
  }
  return total > 1
    ? translate("chat.guide.stepLabel", { title, part: index + 1, total })
    : translate("chat.guide.stepLabelWhole", { title });
}

/** Where a Guided session stands (the step that reached the Guide cursor), for the Session list. */
export function guidePositionLabel(step: RecordedGuideStep): string {
  const part = partOfStep(step);
  if (!part) {
    const { to } = step as GuideStep;
    return step.skim
      ? translate("chat.guide.positionSkimmed", { title: positionTitle(to) })
      : translate("chat.guide.positionBlock", { title: positionTitle(to), where: paragraphsLabel(endParagraph(to), endParagraph(to)) });
  }
  if (step.skim) return translate("chat.guide.positionSkimmed", { title: part.title });
  return part.total > 1
    ? translate("chat.guide.position", { title: part.title, part: part.index + 1, total: part.total })
    : part.title;
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
  /** Current sliding-window context stats, when available. */
  contextStats?: GuideContextStats | null;
  /** Manually collapse active context while keeping chapter recaps. */
  onResetContext?: () => void;
}

function formatCompactTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
}

/** Above the input of a Guided session: the one-tap ways to read on. */
export function GuideBar({ nextStep, started, disabled, onContinue, onSkim, onSkip, onPick, contextStats, onResetContext }: GuideBarProps) {
  const { t } = useT();
  const [contextOpen, setContextOpen] = useState(false);
  if (nextStep === undefined) return null;
  const contextControl = started && contextStats && onResetContext ? (
    <Popover open={contextOpen} onOpenChange={setContextOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 rounded-full text-muted-foreground"
          disabled={disabled}
          aria-label={t("chat.guide.contextTitle")}
          title={t("chat.guide.contextTitle")}
        >
          <Layers className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-60 space-y-2 p-3 text-xs">
        <p className="font-medium text-foreground">{t("chat.guide.contextTitle")}</p>
        <div className="space-y-1 text-muted-foreground">
          <p>{t("chat.guide.contextRecaps", { count: contextStats.recapCount })}</p>
          <p className="tabular-nums">
            {t("chat.guide.contextWindow", {
              tokens: formatCompactTokens(contextStats.activeTokens),
              target: formatCompactTokens(contextStats.windowTarget),
            })}
          </p>
        </div>
        <Button
          size="xs"
          variant="outline"
          className="w-full"
          disabled={disabled || contextStats.activeTokens === 0}
          onClick={() => {
            setContextOpen(false);
            onResetContext();
          }}
        >
          {t("chat.guide.contextReset")}
        </Button>
      </PopoverContent>
    </Popover>
  ) : null;
  if (nextStep === null) {
    return (
      <div className="flex items-center justify-center gap-1.5 px-3 pt-1 text-xs text-muted-foreground" role="status">
        <BookOpen className="h-3.5 w-3.5" />
        <span>{t("chat.guide.end")}</span>
        {contextControl}
      </div>
    );
  }
  const title = positionTitle(nextStep.from);
  const part = partOfStep(nextStep);
  const label = !started
    ? t("chat.guide.start", { title })
    : !part
      ? rangeLabel(nextStep, "chat.guide.continueRange", "chat.guide.continueRangeAcross")
      : part.total > 1
        ? t("chat.guide.continue", { title, part: part.index + 1, total: part.total })
        : t("chat.guide.continueWhole", { title });
  return (
    <div className="flex items-center justify-center gap-1 px-2 pt-1">
      <Tip label={label} overflowOnly>
        <Button
          size="sm"
          variant="secondary"
          className="min-w-0 rounded-full"
          onClick={onContinue}
          disabled={disabled}
        >
          <Play />
          <span className="truncate">{label}</span>
        </Button>
      </Tip>
      <Tip label={t("chat.guide.pick")}>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 rounded-full text-muted-foreground"
          onClick={onPick}
          disabled={disabled}
          aria-label={t("chat.guide.pick")}
        >
          <ListEnd />
        </Button>
      </Tip>
      <Tip label={t("chat.guide.skim")}>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 rounded-full text-muted-foreground"
          onClick={onSkim}
          disabled={disabled}
          aria-label={t("chat.guide.skim")}
        >
          <FastForward />
        </Button>
      </Tip>
      <Tip label={t("chat.guide.skip")}>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 rounded-full text-muted-foreground"
          onClick={onSkip}
          disabled={disabled}
          aria-label={t("chat.guide.skip")}
        >
          <SkipForward />
        </Button>
      </Tip>
      {contextControl}
    </div>
  );
}
