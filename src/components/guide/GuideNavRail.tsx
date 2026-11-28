import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  History,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/ui/tooltip";
import { guidePositionLabel } from "@/components/chat/GuideBar";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import type { TocItem } from "@/components/ReaderView";
import type { GuideDocument } from "@/lib/guide-document";
import { formatSessionTime } from "@/lib/session-time";
import { collapsibleKeys, flattenToc, tocPathKey, unionKeys } from "@/lib/toc-items";
import type { AgentSessionSummary } from "@/types/agent";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type NavTab = "chapters" | "questions";
type QuestionScope = "all" | "current";

interface QuestionItem {
  id: string;
  userMessageIndex: number;
  question: string;
  selection?: string;
}

interface QuestionGroup {
  key: string;
  chapterIndex: number | null;
  title: string;
  isCurrent: boolean;
  items: QuestionItem[];
}

/** Collect ancestor path keys for every TOC node matching `predicate`. */
function ancestorKeysWhere(
  items: readonly TocItem[],
  predicate: (item: TocItem) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (nodes: readonly TocItem[], path: number[], ancestors: string[]) => {
    nodes.forEach((node, index) => {
      const key = tocPathKey([...path, index]);
      if (predicate(node)) {
        for (const ancestor of ancestors) {
          if (seen.has(ancestor)) continue;
          seen.add(ancestor);
          out.push(ancestor);
        }
      }
      if (node.subitems?.length) {
        walk(node.subitems, [...path, index], [...ancestors, key]);
      }
    });
  };
  walk(items, [], []);
  return out;
}

function formatArchiveTooltip(session: AgentSessionSummary, locale: string): string {
  const date = new Date(session.updatedAt);
  if (Number.isNaN(date.getTime())) return session.title;
  return `${session.title}\n${date.toLocaleString(locale)}`;
}

interface GuideTocNodeProps {
  item: TocItem;
  path: number[];
  hasNestedToc: boolean;
  expanded: string[];
  tocProgress?: Record<string, GuideChapterProgress>;
  chapterIndexByTitle: ReadonlyMap<string, number>;
  chapterIndexByHref: ReadonlyMap<string, number>;
  activeChapterIndex: number | null;
  isStreaming: boolean;
  readOnly: boolean;
  scrollActiveIntoView: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onToggle: (key: string) => void;
  onScrollToChapter: (chapterIndex: number) => void;
  onGuideChapter: (href: string) => void;
}

function GuideTocNode({
  item,
  path,
  hasNestedToc,
  expanded,
  tocProgress,
  chapterIndexByTitle,
  chapterIndexByHref,
  activeChapterIndex,
  isStreaming,
  readOnly,
  scrollActiveIntoView,
  listRef,
  onToggle,
  onScrollToChapter,
  onGuideChapter,
}: GuideTocNodeProps) {
  const { t } = useT();
  const rowRef = useRef<HTMLDivElement>(null);
  const key = tocPathKey(path);
  const hasChildren = Boolean(item.subitems?.length);
  const isExpanded = hasChildren && expanded.includes(key);

  const progress = item.href ? tocProgress?.[item.href] : undefined;
  const matchedChapterIndex =
    (item.href ? chapterIndexByHref.get(item.href) : undefined) ??
    chapterIndexByTitle.get(item.label.trim());
  const covered = Boolean(progress || matchedChapterIndex !== undefined);
  const done = Boolean(progress && progress.coveredBlocks >= progress.totalBlocks);
  const percent = progress
    ? Math.floor((progress.coveredBlocks * 100) / Math.max(1, progress.totalBlocks))
    : 0;
  const isActive =
    activeChapterIndex !== null
      ? matchedChapterIndex !== undefined && matchedChapterIndex === activeChapterIndex
      : (progress?.current ?? false);

  useEffect(() => {
    if (!isActive || !scrollActiveIntoView) return;
    const row = rowRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) return;
    list.scrollTop += (rowRect.top + rowRect.bottom - listRect.top - listRect.bottom) / 2;
  }, [isActive, scrollActiveIntoView, listRef]);

  const progressLabel = progress
    ? done
      ? t("toc.guide.done")
      : t("toc.guide.partial", { percent })
    : "";

  return (
    <>
      <div
        ref={rowRef}
        data-active={isActive ? "true" : undefined}
        className={cn(
          "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors",
          isActive
            ? "bg-primary/10 font-medium text-primary"
            : covered
              ? "text-foreground/90 hover:bg-foreground/5"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
        style={{ paddingLeft: `${Math.min(path.length - 1, 3) * 12 + (hasNestedToc ? 4 : 8)}px` }}
      >
        {hasChildren ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t("toc.collapse") : t("toc.expand")}
            onClick={() => onToggle(key)}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        ) : hasNestedToc ? (
          <span className="w-5 shrink-0" aria-hidden />
        ) : null}

        {item.href || matchedChapterIndex !== undefined ? (
          <Tip label={item.label} side="right" overflowOnly>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => {
                if (matchedChapterIndex !== undefined) {
                  onScrollToChapter(matchedChapterIndex);
                } else if (item.href && !isStreaming && !readOnly) {
                  onGuideChapter(item.href);
                }
              }}
            >
              {item.label}
            </button>
          </Tip>
        ) : hasChildren ? (
          <Tip label={item.label} side="right" overflowOnly>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onToggle(key)}
            >
              {item.label}
            </button>
          </Tip>
        ) : (
          <Tip label={item.label} side="right" overflowOnly>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </Tip>
        )}

        {progress && (
          <Tip label={progress.current ? `${progressLabel} · ${t("toc.guide.current")}` : progressLabel}>
            <span
              className="flex shrink-0 items-center gap-1 text-2xs tabular-nums text-muted-foreground"
              aria-label={progress.current ? `${progressLabel}, ${t("toc.guide.current")}` : progressLabel}
            >
              {progress.current && (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
              )}
              <span aria-hidden>{done ? <Check className="h-3 w-3" /> : `${percent}%`}</span>
            </span>
          </Tip>
        )}

        {item.href && !readOnly && (
          <Tip label={t(done ? "toc.guide.reguideChapter" : "toc.guide.startChapter")}>
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
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none [@media(hover:none)]:opacity-100"
            >
              <Play className="h-3 w-3" />
            </button>
          </Tip>
        )}
      </div>

      {hasChildren && isExpanded
        ? item.subitems?.map((sub, i) => (
            <GuideTocNode
              key={`${sub.href}-${i}`}
              item={sub}
              path={[...path, i]}
              hasNestedToc={hasNestedToc}
              expanded={expanded}
              tocProgress={tocProgress}
              chapterIndexByTitle={chapterIndexByTitle}
              chapterIndexByHref={chapterIndexByHref}
              activeChapterIndex={activeChapterIndex}
              isStreaming={isStreaming}
              readOnly={readOnly}
              scrollActiveIntoView={scrollActiveIntoView}
              listRef={listRef}
              onToggle={onToggle}
              onScrollToChapter={onScrollToChapter}
              onGuideChapter={onGuideChapter}
            />
          ))
        : null}
    </>
  );
}

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
  onRenameArchived?: (sessionId: string, title: string) => void;
  onDeleteArchived?: (sessionId: string) => void;
  onRestoreArchived?: (sessionId: string) => void;
  onExportArchived?: (session: AgentSessionSummary) => void;
  onExportMarkdown?: () => void;
}

/**
 * Book-native left navigation rail for desktop Guide mode: replaces
 * `SessionList` with a collapsible chapter progress tree, chapter-grouped
 * side-question index, companion export, and guide settings / archive management.
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
  onRenameArchived,
  onDeleteArchived,
  onRestoreArchived,
  onExportArchived,
  onExportMarkdown,
}: GuideNavRailProps) {
  const { t, locale } = useT();
  const [tab, setTab] = useState<NavTab>("chapters");
  const [questionScope, setQuestionScope] = useState<QuestionScope>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [editingArchiveId, setEditingArchiveId] = useState<string | null>(null);
  const [editingArchiveTitle, setEditingArchiveTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AgentSessionSummary | null>(null);
  const [pendingRestore, setPendingRestore] = useState<AgentSessionSummary | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRunBtnRef = useRef<HTMLButtonElement>(null);
  const renameCommittedRef = useRef(false);

  const isViewingArchived = Boolean(viewingArchivedId);
  const effectiveTocProgress = isViewingArchived ? undefined : tocProgress;

  useEffect(() => {
    renameCommittedRef.current = false;
  }, [editingArchiveId]);

  const flatToc = useMemo(() => flattenToc(toc), [toc]);
  const allCollapsibleKeys = useMemo(() => collapsibleKeys(toc), [toc]);
  const hasNestedToc = allCollapsibleKeys.length > 0;

  const chapterIndexByTitle = useMemo(() => {
    const byTitle = new Map<string, number>();
    for (const run of document.runs) {
      const key = run.chapterTitle.trim();
      if (!byTitle.has(key)) byTitle.set(key, run.chapterIndex);
    }
    return byTitle;
  }, [document.runs]);

  const chapterIndexByHref = useMemo(() => {
    const byHref = new Map<string, number>();
    const runTitleByChapter = new Map<number, string>();
    for (const run of document.runs) {
      if (!runTitleByChapter.has(run.chapterIndex)) {
        runTitleByChapter.set(run.chapterIndex, run.chapterTitle.trim());
      }
    }
    for (const chapter of document.chapters) {
      const runTitle = runTitleByChapter.get(chapter.chapterIndex);
      if (
        chapter.href &&
        runTitle !== undefined &&
        chapter.title.trim() === runTitle &&
        !byHref.has(chapter.href)
      ) {
        byHref.set(chapter.href, chapter.chapterIndex);
      }
    }
    return byHref;
  }, [document.chapters, document.runs]);

  const isTocItemActive = useCallback(
    (item: TocItem): boolean => {
      const progress = item.href ? effectiveTocProgress?.[item.href] : undefined;
      const matched =
        (item.href ? chapterIndexByHref.get(item.href) : undefined) ??
        chapterIndexByTitle.get(item.label.trim());
      return activeChapterIndex !== null
        ? matched !== undefined && matched === activeChapterIndex
        : (progress?.current ?? false);
    },
    [activeChapterIndex, chapterIndexByHref, chapterIndexByTitle, effectiveTocProgress],
  );

  const activeAncestors = useMemo(
    () => ancestorKeysWhere(toc, isTocItemActive),
    [toc, isTocItemActive],
  );

  const [tocExpanded, setTocExpanded] = useState<string[]>(() =>
    ancestorKeysWhere(toc, isTocItemActive),
  );

  useEffect(() => {
    if (activeAncestors.length === 0) return;
    setTocExpanded((current) => unionKeys(current, activeAncestors));
  }, [activeAncestors]);

  const toggleTocKey = useCallback((key: string) => {
    setTocExpanded((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }, []);

  const expandAllToc = useCallback(() => {
    setTocExpanded(allCollapsibleKeys);
  }, [allCollapsibleKeys]);

  const collapseAllToc = useCallback(() => {
    setTocExpanded((current) => {
      const sameAsActive =
        current.length === activeAncestors.length &&
        activeAncestors.every((key) => current.includes(key));
      return sameAsActive ? [] : activeAncestors;
    });
  }, [activeAncestors]);

  // Fallback auto-scroll when TOC is empty and we render document.runs directly.
  useEffect(() => {
    if (toc.length > 0 || tab !== "chapters" || activeChapterIndex === null) return;
    const row = activeRunBtnRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) return;
    list.scrollTop += (rowRect.top + rowRect.bottom - listRect.top - listRect.bottom) / 2;
  }, [toc.length, tab, activeChapterIndex]);

  const coveredCount = useMemo(() => {
    if (!effectiveTocProgress) {
      return new Set(document.runs.map((run) => run.chapterIndex)).size;
    }
    return Object.keys(effectiveTocProgress).length;
  }, [document.runs, effectiveTocProgress]);

  const totalChapters = Math.max(flatToc.filter((item) => Boolean(item.href)).length, coveredCount);

  const questionGroups = useMemo<QuestionGroup[]>(() => {
    const groups: QuestionGroup[] = [];
    if (document.orphanSideThreads.length > 0) {
      groups.push({
        key: "orphan",
        chapterIndex: null,
        title: t("guide.navQuestionsOrphan"),
        isCurrent: activeChapterIndex === null,
        items: document.orphanSideThreads.map((qa) => ({
          id: qa.id,
          userMessageIndex: qa.userMessageIndex,
          question: qa.question,
          selection: qa.selection,
        })),
      });
    }
    const byChapter = new Map<number, QuestionGroup>();
    for (const run of document.runs) {
      if (run.sideThreads.length === 0) continue;
      let group = byChapter.get(run.chapterIndex);
      if (!group) {
        group = {
          key: `chapter-${run.chapterIndex}`,
          chapterIndex: run.chapterIndex,
          title: run.chapterTitle,
          isCurrent: run.chapterIndex === activeChapterIndex,
          items: [],
        };
        byChapter.set(run.chapterIndex, group);
        groups.push(group);
      }
      for (const qa of run.sideThreads) {
        group.items.push({
          id: qa.id,
          userMessageIndex: qa.userMessageIndex,
          question: qa.question,
          selection: qa.selection,
        });
      }
    }
    return groups;
  }, [activeChapterIndex, document.orphanSideThreads, document.runs, t]);

  const totalQuestionCount = useMemo(
    () => questionGroups.reduce((sum, group) => sum + group.items.length, 0),
    [questionGroups],
  );

  const currentChapterQuestionCount = useMemo(
    () =>
      questionGroups
        .filter((group) => group.isCurrent)
        .reduce((sum, group) => sum + group.items.length, 0),
    [questionGroups],
  );

  const visibleQuestionGroups = useMemo(
    () =>
      questionScope === "current"
        ? questionGroups.filter((group) => group.isCurrent)
        : questionGroups,
    [questionGroups, questionScope],
  );

  const toggleQuestionGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const hasArchiveMenuActions = Boolean(
    onRenameArchived || onExportArchived || onRestoreArchived || onDeleteArchived,
  );

  const commitArchiveRename = useCallback(
    (session: AgentSessionSummary) => {
      const clean = editingArchiveTitle.trim();
      setEditingArchiveId(null);
      setEditingArchiveTitle("");
      if (!clean || clean === session.title) return;
      onRenameArchived?.(session.id, clean);
    },
    [editingArchiveTitle, onRenameArchived],
  );

  const cancelArchiveRename = useCallback(() => {
    setEditingArchiveId(null);
    setEditingArchiveTitle("");
  }, []);

  return (
    <aside
      data-testid="guide-nav-rail"
      aria-label={t("guide.navTitle")}
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="space-y-2 p-2 pb-1.5">
        <div className="flex items-center justify-between gap-1 px-1">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">
              {totalChapters > 0
                ? t("guide.navProgress", { covered: coveredCount, total: totalChapters })
                : t("guide.navTitle")}
            </span>
          </span>
          <div className="flex shrink-0 items-center">
            {tab === "chapters" && hasNestedToc && (
              <>
                <Tip label={t("toc.expandAll")}>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("toc.expandAll")}
                    onClick={expandAllToc}
                  >
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
                <Tip label={t("toc.collapseAll")}>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("toc.collapseAll")}
                    onClick={collapseAllToc}
                  >
                    <ChevronsDownUp className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              </>
            )}
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
            {totalQuestionCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-2xs tabular-nums text-muted-foreground">
                {totalQuestionCount}
              </span>
            )}
          </button>
        </div>

        {tab === "questions" && totalQuestionCount > 0 && (
          <div
            data-testid="guide-questions-scope"
            className="flex items-center gap-1 px-0.5"
          >
            <button
              type="button"
              aria-pressed={questionScope === "all"}
              onClick={() => setQuestionScope("all")}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                questionScope === "all"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {t("guide.navQuestionsAll")}
              <span className="ml-1 tabular-nums opacity-80">{totalQuestionCount}</span>
            </button>
            <button
              type="button"
              aria-pressed={questionScope === "current"}
              onClick={() => setQuestionScope("current")}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                questionScope === "current"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {t("guide.navQuestionsCurrent")}
              <span className="ml-1 tabular-nums opacity-80">{currentChapterQuestionCount}</span>
            </button>
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {tab === "chapters" ? (
          toc.length > 0 ? (
            <div className="space-y-0.5">
              {toc.map((item, idx) => (
                <GuideTocNode
                  key={`${item.href}-${idx}`}
                  item={item}
                  path={[idx]}
                  hasNestedToc={hasNestedToc}
                  expanded={tocExpanded}
                  tocProgress={effectiveTocProgress}
                  chapterIndexByTitle={chapterIndexByTitle}
                  chapterIndexByHref={chapterIndexByHref}
                  activeChapterIndex={activeChapterIndex}
                  isStreaming={isStreaming}
                  readOnly={isViewingArchived}
                  scrollActiveIntoView={tab === "chapters"}
                  listRef={listRef}
                  onToggle={toggleTocKey}
                  onScrollToChapter={onScrollToChapter}
                  onGuideChapter={onGuideChapter}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {document.runs.map((run) => {
                const isActive = run.chapterIndex === activeChapterIndex;
                return (
                  <Tip key={run.id} label={run.chapterTitle} side="right" overflowOnly>
                    <button
                      ref={isActive ? activeRunBtnRef : undefined}
                      type="button"
                      onClick={() => onScrollToChapter(run.chapterIndex)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                        isActive
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground/85 hover:bg-foreground/5",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{run.chapterTitle}</span>
                    </button>
                  </Tip>
                );
              })}
            </div>
          )
        ) : totalQuestionCount === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("guide.navNoQuestions")}
          </p>
        ) : visibleQuestionGroups.length === 0 ? (
          <div className="space-y-2 px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">{t("guide.navNoChapterQuestions")}</p>
            <button
              type="button"
              onClick={() => setQuestionScope("all")}
              className="text-2xs font-medium text-primary hover:underline"
            >
              {t("guide.navShowAllQuestions")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleQuestionGroups.map((group) => {
              const isCollapsed = Boolean(collapsedGroups[group.key]);
              return (
                <section
                  key={group.key}
                  data-testid="guide-question-group"
                  data-chapter-index={group.chapterIndex ?? undefined}
                >
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleQuestionGroup(group.key)}
                    className={cn(
                      "flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-2xs font-medium transition-colors hover:bg-foreground/5",
                      group.isCurrent ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
                    )}
                    <Tip label={group.title} side="right" overflowOnly>
                      <span className="min-w-0 flex-1 truncate">{group.title}</span>
                    </Tip>
                    <span className="shrink-0 tabular-nums opacity-75">{group.items.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="mt-0.5 space-y-0.5 pl-1">
                      {group.items.map((qa) => (
                        <button
                          key={qa.id}
                          type="button"
                          onClick={() => onScrollToQuestion(qa.userMessageIndex)}
                          className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
                        >
                          <span className="flex items-start gap-1.5 text-xs text-foreground">
                            <MessageSquare
                              className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            <span className="line-clamp-2">{qa.question}</span>
                          </span>
                          {qa.selection && (
                            <span className="ml-4.5 line-clamp-1 border-l-2 border-primary/40 pl-1.5 text-2xs text-muted-foreground">
                              {qa.selection}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-border/60 p-2">
        {archivedSessions.length > 0 && (
          <div>
            {viewingArchivedId && !archivedOpen && (
              <button
                type="button"
                onClick={onReturnToCanonical}
                className="mb-1 w-full truncate rounded-md bg-primary/10 px-2 py-1 text-left text-2xs font-medium text-primary hover:bg-primary/15"
              >
                ← {t("guide.navArchivedBack")}
              </button>
            )}
            <button
              type="button"
              aria-expanded={archivedOpen}
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <Archive className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{t("guide.navArchived")}</span>
              <span className="text-2xs tabular-nums">{archivedSessions.length}</span>
            </button>
            {archivedOpen && (
              <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pl-1">
                {viewingArchivedId && (
                  <button
                    type="button"
                    onClick={onReturnToCanonical}
                    className="w-full truncate rounded-md px-2 py-1 text-left text-2xs font-medium text-primary hover:bg-primary/10"
                  >
                    ← {t("guide.navArchivedBack")}
                  </button>
                )}
                {archivedSessions.map((session) => {
                  const active = viewingArchivedId === session.id;
                  const timeLabel = formatSessionTime(session.updatedAt, locale);
                  const progressSubtitle = session.guide ? guidePositionLabel(session.guide) : "";
                  return (
                    <div
                      key={session.id}
                      data-testid="guide-archived-row"
                      className={cn(
                        "group relative flex items-center rounded-md text-2xs transition-colors",
                        active ? "bg-primary/10 text-primary" : "hover:bg-foreground/5",
                      )}
                    >
                      {editingArchiveId === session.id ? (
                        <input
                          aria-label={t("chat.rename")}
                          className="mx-1 my-0.5 min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-2xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          value={editingArchiveTitle}
                          onChange={(event) => setEditingArchiveTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              renameCommittedRef.current = true;
                              commitArchiveRename(session);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              renameCommittedRef.current = true;
                              cancelArchiveRename();
                            }
                          }}
                          onBlur={() => {
                            if (renameCommittedRef.current) {
                              renameCommittedRef.current = false;
                              return;
                            }
                            commitArchiveRename(session);
                          }}
                          autoFocus
                        />
                      ) : (
                        <>
                          <Tip label={formatArchiveTooltip(session, locale)} side="right">
                            <button
                              type="button"
                              disabled={isStreaming}
                              onClick={() => onViewArchived(session.id)}
                              className={cn(
                                "flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-2 pl-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
                                active
                                  ? "font-medium text-primary"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate">{session.title}</span>
                                {progressSubtitle && (
                                  <span className="truncate text-[10px] opacity-75">
                                    {progressSubtitle}
                                  </span>
                                )}
                              </span>
                              {timeLabel && (
                                <span
                                  className={cn(
                                    "shrink-0 text-right text-[10px] tabular-nums opacity-75",
                                    hasArchiveMenuActions &&
                                      "group-hover:invisible group-has-[:focus-visible]:invisible group-has-[[data-state=open]]:invisible",
                                  )}
                                >
                                  {timeLabel}
                                </span>
                              )}
                            </button>
                          </Tip>

                          {hasArchiveMenuActions && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  disabled={isStreaming}
                                  aria-label={t("guide.navArchivedActions")}
                                  className="absolute right-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 disabled:pointer-events-none data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="min-w-40"
                                onCloseAutoFocus={(event) => event.preventDefault()}
                              >
                                {onRenameArchived && (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setEditingArchiveId(session.id);
                                      setEditingArchiveTitle(session.title);
                                    }}
                                  >
                                    <Pencil />
                                    {t("chat.rename")}
                                  </DropdownMenuItem>
                                )}
                                {onExportArchived && (
                                  <DropdownMenuItem onSelect={() => onExportArchived(session)}>
                                    <Download />
                                    {t("guide.navArchivedExport")}
                                  </DropdownMenuItem>
                                )}
                                {onRestoreArchived && (
                                  <DropdownMenuItem onSelect={() => setPendingRestore(session)}>
                                    <RotateCcw />
                                    {t("guide.navArchivedRestore")}
                                  </DropdownMenuItem>
                                )}
                                {onDeleteArchived && (
                                  <>
                                    {(onRenameArchived || onExportArchived || onRestoreArchived) && (
                                      <DropdownMenuSeparator />
                                    )}
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => setPendingDelete(session)}
                                    >
                                      <Trash2 />
                                      {t("common.delete")}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
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

      <AlertDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("guide.navArchivedRestoreTitle", { title: pendingRestore?.title ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("guide.navArchivedRestoreDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRestore) onRestoreArchived?.(pendingRestore.id);
              }}
            >
              {t("guide.navArchivedRestoreConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("guide.navArchivedDeleteTitle", { title: pendingDelete?.title ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("guide.navArchivedDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDeleteArchived?.(pendingDelete.id);
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
