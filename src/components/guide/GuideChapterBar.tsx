import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import {
  searchGuideDocument,
  type GuideChapterRun,
  type GuideDocument,
  type GuideSearchHit,
} from "@/lib/guide-document";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface GuideChapterBarProps {
  document: GuideDocument;
  activeRun: GuideChapterRun;
  activeRunIndex: number;
  isViewingHistory: boolean;
  compact?: boolean;
  onSelectRun: (runId: string) => void;
  onJumpLatest: () => void;
  onJumpToHit: (hit: GuideSearchHit) => void;
}

/**
 * Sticky chapter-scoped navigation bar for `GuideWorkspace`: sequential
 * prev/next controls, a searchable chapter switcher + whole-guide content
 * finder popover, and a one-click return to the latest Guide cursor.
 */
export function GuideChapterBar({
  document,
  activeRun,
  activeRunIndex,
  isViewingHistory,
  compact = false,
  onSelectRun,
  onJumpLatest,
  onJumpToHit,
}: GuideChapterBarProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const runs = document.runs;
  const totalRuns = runs.length;
  const prevRun = activeRunIndex > 0 ? runs[activeRunIndex - 1] : null;
  const nextRun = activeRunIndex >= 0 && activeRunIndex + 1 < totalRuns ? runs[activeRunIndex + 1] : null;
  const latestRun = totalRuns > 0 ? runs[totalRuns - 1] : null;

  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();

  const matchingRuns = useMemo(() => {
    if (!lowerQuery) return runs;
    return runs.filter((run) => run.chapterTitle.toLowerCase().includes(lowerQuery));
  }, [lowerQuery, runs]);

  const searchHits = useMemo(
    () => (trimmedQuery ? searchGuideDocument(document, trimmedQuery, 20) : []),
    [document, trimmedQuery],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  };

  return (
    <div
      data-testid="guide-chapter-bar"
      aria-label={t("guide.chapterBarLabel")}
      className={cn(
        "flex shrink-0 items-center gap-1 border-b border-border/60 bg-background/85 backdrop-blur-xs",
        compact ? "px-2 py-1" : "px-3 py-1.5",
      )}
    >
      {totalRuns > 1 && (
        <Tip label={prevRun ? `${t("guide.prevChapter")}: ${prevRun.chapterTitle}` : t("guide.prevChapter")}>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={!prevRun}
            aria-label={t("guide.prevChapter")}
            onClick={() => prevRun && onSelectRun(prevRun.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      )}

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="guide-chapter-switcher"
            aria-label={t("guide.switchChapter")}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate font-medium text-foreground">
              {activeRun.chapterTitle}
            </span>
            {activeRun.isReread && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                {t("guide.chapterReread")}
              </span>
            )}
            {totalRuns > 1 && (
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {activeRunIndex + 1}/{totalRuns}
              </span>
            )}
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-80 max-w-[calc(100vw-2rem)] p-2"
        >
          <div className="relative mb-2 flex items-center">
            <Search
              className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("guide.searchPlaceholder")}
              aria-label={t("guide.searchPlaceholder")}
              data-testid="guide-chapter-search"
              className="h-8 w-full rounded-lg border border-border/70 bg-background pr-7 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
            {!trimmedQuery ? (
              <div className="space-y-0.5">
                {runs.map((run, index) => {
                  const isActive = run.id === activeRun.id;
                  const isLatest = index === totalRuns - 1;
                  const questionCount = run.steps.reduce(
                    (sum, step) => sum + step.sideThreads.length,
                    0,
                  );
                  return (
                    <button
                      key={run.id}
                      type="button"
                      data-testid="guide-chapter-option"
                      onClick={() => {
                        onSelectRun(run.id);
                        handleOpenChange(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                        isActive
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground/90 hover:bg-foreground/5",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{run.chapterTitle}</span>
                      {run.isReread && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                          {t("guide.chapterReread")}
                        </span>
                      )}
                      {isLatest && totalRuns > 1 && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
                          {t("guide.chapterLatestBadge")}
                        </span>
                      )}
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                        {t("guide.chapterStepsCount", { count: run.steps.length })}
                        {questionCount > 0 ? ` · ${questionCount}` : ""}
                      </span>
                      {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            ) : matchingRuns.length === 0 && searchHits.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {t("guide.searchEmpty")}
              </p>
            ) : (
              <>
                {matchingRuns.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="px-2 pt-0.5 text-2xs font-medium text-muted-foreground">
                      {t("guide.searchChaptersSection")}
                    </p>
                    {matchingRuns.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => {
                          onSelectRun(run.id);
                          handleOpenChange(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                          run.id === activeRun.id
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-foreground/90 hover:bg-foreground/5",
                        )}
                      >
                        <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{run.chapterTitle}</span>
                        {run.isReread && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                            {t("guide.chapterReread")}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {searchHits.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="px-2 pt-1 text-2xs font-medium text-muted-foreground">
                      {t("guide.searchMatchesSection")}
                    </p>
                    {searchHits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        data-testid="guide-search-hit"
                        onClick={() => {
                          onJumpToHit(hit);
                          handleOpenChange(false);
                        }}
                        className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
                      >
                        <span className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
                          {hit.kind === "question" ? (
                            <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
                          ) : (
                            <BookOpen className="h-3 w-3 shrink-0" aria-hidden />
                          )}
                          <span className="truncate">{hit.chapterTitle}</span>
                        </span>
                        <span className="line-clamp-2 text-xs text-foreground">
                          {hit.snippet}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {totalRuns > 1 && (
        <Tip label={nextRun ? `${t("guide.nextChapter")}: ${nextRun.chapterTitle}` : t("guide.nextChapter")}>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={!nextRun}
            aria-label={t("guide.nextChapter")}
            onClick={() => nextRun && onSelectRun(nextRun.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      )}

      {isViewingHistory && latestRun && (
        <Tip label={t("guide.backToLatestTip", { title: latestRun.chapterTitle })}>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            data-testid="guide-jump-latest"
            onClick={onJumpLatest}
            className="ml-0.5 h-6 shrink-0 gap-1 rounded-full bg-primary/10 px-2 text-2xs font-medium text-primary hover:bg-primary/15"
          >
            <ArrowDownToLine className="h-3 w-3" aria-hidden />
            <span>{t("guide.backToLatest")}</span>
          </Button>
        </Tip>
      )}
    </div>
  );
}

interface GuideChapterFooterProps {
  prevRun: GuideChapterRun | null;
  nextRun: GuideChapterRun | null;
  onSelectRun: (runId: string) => void;
}

/**
 * End-of-chapter sequential footer inside the scroll viewport so finishing a
 * history chapter flows straight into the next without reaching back to the bar.
 */
export function GuideChapterFooter({
  prevRun,
  nextRun,
  onSelectRun,
}: GuideChapterFooterProps) {
  const { t } = useT();
  if (!prevRun && !nextRun) return null;

  return (
    <nav
      data-testid="guide-chapter-footer"
      aria-label={t("guide.chapterBarLabel")}
      className="flex items-stretch justify-between gap-2 border-t border-border/60 pt-4 pb-1"
    >
      {prevRun ? (
        <button
          type="button"
          onClick={() => onSelectRun(prevRun.id)}
          className="group flex min-w-0 max-w-[48%] items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/40"
        >
          <ChevronLeft
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5"
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block text-2xs text-muted-foreground">{t("guide.prevChapter")}</span>
            <span className="block truncate text-xs font-medium text-foreground">
              {prevRun.chapterTitle}
            </span>
          </span>
        </button>
      ) : (
        <span />
      )}

      {nextRun && (
        <button
          type="button"
          onClick={() => onSelectRun(nextRun.id)}
          className="group ml-auto flex min-w-0 max-w-[48%] items-center justify-end gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-right transition-colors hover:border-border hover:bg-muted/40"
        >
          <span className="min-w-0">
            <span className="block text-2xs text-muted-foreground">{t("guide.nextChapter")}</span>
            <span className="block truncate text-xs font-medium text-foreground">
              {nextRun.chapterTitle}
            </span>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>
      )}
    </nav>
  );
}
