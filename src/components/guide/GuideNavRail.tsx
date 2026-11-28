import { useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Check,
  Download,
  History,
  MessageSquare,
  Play,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import type { TocItem } from "@/components/ReaderView";
import type { GuideDocument } from "@/lib/guide-document";
import type { AgentSessionSummary } from "@/types/agent";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function flattenTocWithDepth(items: readonly TocItem[], depth = 0): Array<{ href: string; label: string; depth: number }> {
  const out: Array<{ href: string; label: string; depth: number }> = [];
  for (const item of items) {
    if (item.href) out.push({ href: item.href, label: item.label, depth });
    if (item.subitems?.length) out.push(...flattenTocWithDepth(item.subitems, depth + 1));
  }
  return out;
}

type NavTab = "chapters" | "questions";

interface GuideNavRailProps {
  toc: TocItem[];
  tocProgress?: Record<string, GuideChapterProgress>;
  document: GuideDocument;
  activeChapterIndex: number | null;
  archivedSessions: readonly AgentSessionSummary[];
  viewingArchivedId: string | null;
  isStreaming: boolean;
  onScrollToChapter: (chapterIndex: number) => void;
  onScrollToStep: (stepIndex: number) => void;
  onScrollToQuestion: (userMessageIndex: number) => void;
  onGuideChapter: (href: string) => void;
  onOpenSettings: () => void;
  onViewArchived: (sessionId: string) => void;
  onReturnToCanonical: () => void;
  onExportMarkdown?: () => void;
}

/**
 * Book-native left navigation rail for desktop Guide mode: replaces
 * `SessionList` with chapter guide progress, a side-question index,
 * companion export, and guide settings / archived guides access.
 */
export function GuideNavRail({
  toc,
  tocProgress,
  document,
  activeChapterIndex,
  archivedSessions,
  viewingArchivedId,
  isStreaming,
  onScrollToChapter,
  onScrollToStep,
  onScrollToQuestion,
  onGuideChapter,
  onOpenSettings,
  onViewArchived,
  onReturnToCanonical,
  onExportMarkdown,
}: GuideNavRailProps) {
  const { t } = useT();
  const [tab, setTab] = useState<NavTab>("chapters");
  const [archivedOpen, setArchivedOpen] = useState(false);

  const flatToc = useMemo(() => flattenTocWithDepth(toc), [toc]);

  const chapterStepsByTitleOrHref = useMemo(() => {
    const byTitle = new Map<string, number>();
    for (const run of document.runs) {
      if (!byTitle.has(run.chapterTitle)) byTitle.set(run.chapterTitle, run.chapterIndex);
    }
    return byTitle;
  }, [document.runs]);

  const coveredCount = useMemo(() => {
    if (!tocProgress) return document.runs.length;
    return Object.keys(tocProgress).length;
  }, [document.runs.length, tocProgress]);

  const totalChapters = Math.max(flatToc.filter((item) => Boolean(item.href)).length, coveredCount);

  const allQuestions = useMemo(() => {
    const list: Array<{
      id: string;
      userMessageIndex: number;
      question: string;
      chapterTitle?: string;
    }> = [];
    for (const qa of document.orphanSideThreads) {
      list.push({ id: qa.id, userMessageIndex: qa.userMessageIndex, question: qa.question });
    }
    for (const run of document.runs) {
      for (const qa of run.sideThreads) {
        list.push({
          id: qa.id,
          userMessageIndex: qa.userMessageIndex,
          question: qa.question,
          chapterTitle: run.chapterTitle,
        });
      }
    }
    return list;
  }, [document]);

  return (
    <aside
      data-testid="guide-nav-rail"
      aria-label={t("guide.navTitle")}
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="space-y-2 p-2 pb-1.5">
        <div className="flex items-center justify-between gap-1 px-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span className="truncate">
              {totalChapters > 0
                ? t("guide.navProgress", { covered: coveredCount, total: totalChapters })
                : t("guide.navTitle")}
            </span>
          </span>
          {document.steps.length > 0 && (
            <Tip label={t("guide.navJumpCursor")}>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("guide.navJumpCursor")}
                onClick={() => onScrollToStep(document.steps.length - 1)}
              >
                <History className="h-3.5 w-3.5" />
              </Button>
            </Tip>
          )}
        </div>

        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-foreground/5 p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chapters"}
            onClick={() => setTab("chapters")}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              tab === "chapters"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("guide.navChapters")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "questions"}
            onClick={() => setTab("questions")}
            className={cn(
              "flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              tab === "questions"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{t("guide.navQuestions")}</span>
            {allQuestions.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-2xs tabular-nums text-muted-foreground">
                {allQuestions.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {tab === "chapters" ? (
          flatToc.length > 0 ? (
            <div className="space-y-0.5">
              {flatToc.map((item, idx) => {
                const progress = item.href ? tocProgress?.[item.href] : undefined;
                const matchedChapterIndex = chapterStepsByTitleOrHref.get(item.label.trim());
                const covered = Boolean(progress || matchedChapterIndex !== undefined);
                const done = Boolean(progress && progress.coveredBlocks >= progress.totalBlocks);
                const percent = progress
                  ? Math.floor((progress.coveredBlocks * 100) / Math.max(1, progress.totalBlocks))
                  : 0;
                const isActive =
                  activeChapterIndex !== null
                    ? matchedChapterIndex !== undefined && matchedChapterIndex === activeChapterIndex
                    : (progress?.current ?? false);

                return (
                  <div
                    key={`${item.href}-${idx}`}
                    className={cn(
                      "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors",
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : covered
                          ? "text-foreground/90 hover:bg-foreground/5"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                    )}
                    style={{ paddingLeft: `${Math.min(item.depth, 3) * 10 + 8}px` }}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => {
                        if (matchedChapterIndex !== undefined) {
                          onScrollToChapter(matchedChapterIndex);
                        } else if (item.href && !isStreaming) {
                          onGuideChapter(item.href);
                        }
                      }}
                    >
                      {item.label}
                    </button>
                    {progress && (
                      <span className="flex shrink-0 items-center gap-1 text-2xs tabular-nums text-muted-foreground">
                        {progress.current && (
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                        {done ? <Check className="h-3 w-3" /> : `${percent}%`}
                      </span>
                    )}
                    {item.href && (
                      <Tip
                        label={t(done ? "toc.guide.reguideChapter" : "toc.guide.startChapter")}
                      >
                        <button
                          type="button"
                          disabled={isStreaming}
                          aria-label={t(
                            done ? "toc.guide.reguideChapterAria" : "toc.guide.startChapterAria",
                            { title: item.label },
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            onGuideChapter(item.href);
                          }}
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none"
                        >
                          <Play className="h-3 w-3" />
                        </button>
                      </Tip>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-0.5">
              {document.runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onScrollToChapter(run.chapterIndex)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                    run.chapterIndex === activeChapterIndex
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground/85 hover:bg-foreground/5",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{run.chapterTitle}</span>
                </button>
              ))}
            </div>
          )
        ) : allQuestions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("guide.navNoQuestions")}
          </p>
        ) : (
          <div className="space-y-1">
            {allQuestions.map((qa) => (
              <button
                key={qa.id}
                type="button"
                onClick={() => onScrollToQuestion(qa.userMessageIndex)}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
              >
                <span className="flex items-start gap-1.5 text-xs text-foreground">
                  <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-2">{qa.question}</span>
                </span>
                {qa.chapterTitle && (
                  <span className="pl-4.5 text-2xs text-muted-foreground truncate">
                    {qa.chapterTitle}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-border/60 p-2">
        {archivedSessions.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <Archive className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{t("guide.navArchived")}</span>
              <span className="text-2xs tabular-nums">{archivedSessions.length}</span>
            </button>
            {archivedOpen && (
              <div className="mt-1 space-y-0.5 pl-2">
                {viewingArchivedId && (
                  <button
                    type="button"
                    onClick={onReturnToCanonical}
                    className="w-full truncate rounded-md px-2 py-1 text-left text-2xs font-medium text-primary hover:bg-primary/10"
                  >
                    ← {t("guide.navArchivedBack")}
                  </button>
                )}
                {archivedSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => onViewArchived(session.id)}
                    className={cn(
                      "w-full truncate rounded-md px-2 py-1 text-left text-2xs transition-colors",
                      viewingArchivedId === session.id
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                    )}
                  >
                    {session.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {onExportMarkdown && document.hasStarted && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full justify-start rounded-lg text-xs font-normal text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            onClick={onExportMarkdown}
          >
            <Download className="h-3.5 w-3.5" />
            {t("guide.navExport")}
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full justify-start rounded-lg text-xs font-normal text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onOpenSettings}
          disabled={isStreaming}
        >
          <Settings className="h-3.5 w-3.5" />
          {t("guide.navSettings")}
        </Button>
      </div>
    </aside>
  );
}
