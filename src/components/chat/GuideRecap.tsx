import { useState } from "react";
import { BookMarked, ChevronRight } from "lucide-react";
import type { GuideRecapMarker } from "@/types/agent";
import { t as translate, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MarkdownText } from "./AssistantMessage";

/**
 * Transcript marker for a chapter recap in a Guided session: where the guide
 * finished a chapter (or, in one step, several), what the assistant keeps of
 * it. Collapsed by default.
 */
export function GuideRecap({ recap }: { recap: GuideRecapMarker }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const title = recap.chapterTitle ?? translate("chat.guide.chapterFallback", { number: recap.chapterIndex + 1 });
  const label = recap.throughChapterIndex === undefined
    ? t("chat.guide.recap", { title })
    : t("chat.guide.recapRange", {
        from: title,
        to: recap.throughChapterTitle ?? translate("chat.guide.chapterFallback", { number: recap.throughChapterIndex + 1 }),
      });
  return (
    <div data-testid="guide-recap" className="py-1 text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t(expanded ? "chat.guide.recapHide" : "chat.guide.recapShow")}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 rounded transition-colors hover:text-foreground"
      >
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span className="flex min-w-0 items-center gap-1">
          <BookMarked className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronRight
            className={cn("h-3 w-3 shrink-0 transition-transform duration-150", expanded && "rotate-90")}
            aria-hidden
          />
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </button>
      {expanded && (
        <div
          data-testid="guide-recap-text"
          className="mt-1.5 max-h-80 overflow-auto rounded-md border bg-muted/40 px-3 py-2 text-foreground"
        >
          <MarkdownText text={recap.text} />
        </div>
      )}
    </div>
  );
}
