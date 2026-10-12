import { memo, useState } from "react";
import { BookOpen, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { isPartialCoverage, type SourceSummary } from "@/lib/source-summary";
import { ToolCallCard } from "./ToolCallCard";

/**
 * One line stating what an answer drew on from the Book (chapters and parts
 * read, searches, lookups), standing in for the answer's tool-call cards.
 * Expanding it reveals those cards.
 */
export const SourceSummaryCard = memo(function SourceSummaryCard({ summary }: { summary: SourceSummary }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const partial = summary.chapters.some(isPartialCoverage);
  const segments: { key: string; text: string; partial?: boolean; error?: boolean }[] = [];
  for (const chapter of summary.chapters) {
    const title = chapter.title ?? t("chat.sources.chapterFallback", { number: chapter.chapterNumber });
    segments.push(
      isPartialCoverage(chapter)
        ? {
            key: `chapter-${chapter.chapterIndex}`,
            text: t("chat.sources.partial", { title, read: chapter.partsRead.length, total: chapter.totalParts }),
            partial: true,
          }
        : { key: `chapter-${chapter.chapterIndex}`, text: title },
    );
  }
  if (summary.searches > 0) {
    segments.push({ key: "search", text: t("chat.sources.search", { count: summary.searches, hits: summary.hits }) });
  }
  for (const lookup of summary.lookups) {
    segments.push({ key: lookup, text: t(`chat.sources.${lookup}`) });
  }
  if (summary.failed > 0) {
    segments.push({ key: "failed", text: t("chat.sources.failed", { count: summary.failed }), error: true });
  }

  return (
    <div className="-ml-1 rounded px-1 transition-colors hover:bg-muted/40" data-testid="source-summary">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-1.5 py-0.5 text-left"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        {summary.running ? (
          <Loader2
            className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : partial ? (
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" role="img" aria-label={t("chat.sources.partialHint")} />
        ) : (
          <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="min-w-0 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("chat.sources.label")}</span>
          {segments.length === 0 && summary.running ? (
            <span className="ml-1.5 animate-pulse motion-reduce:animate-none">{t("chat.sources.reading")}</span>
          ) : (
            segments.map((segment, index) => (
              <span key={segment.key}>
                <span className="mx-1.5 text-muted-foreground/50">{index === 0 ? "" : "·"}</span>
                <span
                  className={cn(
                    segment.partial && "text-amber-700 dark:text-amber-500",
                    segment.error && "text-destructive",
                  )}
                >
                  {segment.text}
                </span>
              </span>
            ))
          )}
        </span>
      </button>
      {expanded && (
        <div className="space-y-0.5 pb-1 pl-5">
          {summary.calls.map((call) => (
            <ToolCallCard key={call.toolCallId} call={call} />
          ))}
        </div>
      )}
    </div>
  );
});
