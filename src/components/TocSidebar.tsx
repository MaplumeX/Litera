import { useEffect, useRef, type RefObject } from "react";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { TocItem } from "@/components/ReaderView";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { tocPathKey } from "@/lib/toc-items";
import { cn } from "@/lib/utils";

interface TocSidebarProps {
  toc: TocItem[];
  currentHref?: string;
  expanded: string[];
  onToggle: (key: string) => void;
  onGoTo: (href: string) => void;
  /** Agent mode in a Guided session: how far the guide has got, per href. */
  guideProgress?: Record<string, GuideChapterProgress>;
}

/** A Guided session's progress on one TOC row. */
function GuideMark({ progress }: { progress: GuideChapterProgress }) {
  const { t } = useT();
  const done = progress.coveredBlocks >= progress.totalBlocks;
  // Rounded down, so a chapter shows 100% only once it is done.
  const percent = Math.floor((progress.coveredBlocks * 100) / Math.max(1, progress.totalBlocks));
  const label = progress.skimmed
    ? t("toc.guide.skimmed")
    : done
      ? t("toc.guide.done")
      : t("toc.guide.partial", { percent });
  return (
    <span
      className="ml-1 flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
      title={progress.current ? `${label} · ${t("toc.guide.current")}` : label}
      aria-label={progress.current ? `${label}, ${t("toc.guide.current")}` : label}
    >
      {progress.current && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />}
      <span aria-hidden>
        {progress.skimmed
          ? t("toc.guide.skimmedShort")
          : done
            ? <Check className="h-3.5 w-3.5" />
            : `${percent}%`}
      </span>
    </span>
  );
}

function TocNode({
  item,
  path,
  currentHref,
  expanded,
  onToggle,
  onGoTo,
  listRef,
  guideProgress,
}: {
  item: TocItem;
  path: number[];
  currentHref?: string;
  expanded: string[];
  onToggle: (key: string) => void;
  onGoTo: (href: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
  guideProgress?: Record<string, GuideChapterProgress>;
}) {
  const progress = item.href ? guideProgress?.[item.href] : undefined;
  const { t } = useT();
  const isCurrent = Boolean(currentHref) && item.href === currentHref;
  const rowRef = useRef<HTMLDivElement>(null);
  const key = tocPathKey(path);
  const hasChildren = Boolean(item.subitems?.length);
  const isExpanded = hasChildren && expanded.includes(key);

  useEffect(() => {
    if (!isCurrent) return;
    const row = rowRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) return;
    list.scrollTop +=
      (rowRect.top + rowRect.bottom - listRect.top - listRect.bottom) / 2;
  }, [isCurrent, listRef]);

  return (
    <>
      <div
        ref={rowRef}
        className={cn(
          "relative flex w-full items-center rounded-md px-2 py-1.5 text-sm transition-colors duration-150 motion-reduce:transition-none",
          isCurrent
            ? "bg-accent font-medium text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
        )}
        style={{ paddingLeft: `${(path.length - 1) * 12 + 12}px` }}
      >
        {hasChildren ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t("toc.collapse") : t("toc.expand")}
            onClick={() => onToggle(key)}
          >
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        {item.href ? (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left"
            title={item.label}
            onClick={() => onGoTo(item.href)}
          >
            {item.label}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate" title={item.label}>
            {item.label}
          </span>
        )}
        {progress && <GuideMark progress={progress} />}
      </div>
      {hasChildren && isExpanded
        ? item.subitems?.map((sub, i) => (
            <TocNode
              key={i}
              item={sub}
              path={[...path, i]}
              currentHref={currentHref}
              expanded={expanded}
              onToggle={onToggle}
              onGoTo={onGoTo}
              listRef={listRef}
              guideProgress={guideProgress}
            />
          ))
        : null}
    </>
  );
}

/** Expand-all / collapse-all, for the side panel's header while on Contents. */
export function TocSidebarActions({
  onExpandAll,
  onCollapseAll,
}: {
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  const { t } = useT();
  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-muted-foreground"
        aria-label={t("toc.expandAll")}
        onClick={onExpandAll}
      >
        <ChevronsUpDown />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-muted-foreground"
        aria-label={t("toc.collapseAll")}
        onClick={onCollapseAll}
      >
        <ChevronsDownUp />
      </Button>
    </>
  );
}

export function TocSidebar({
  toc,
  currentHref,
  expanded,
  onToggle,
  onGoTo,
  guideProgress,
}: TocSidebarProps) {
  const { t } = useT();
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <nav aria-label={t("toc.title")} className="flex h-full w-full flex-col overflow-hidden">
      <div ref={listRef} className="flex-1 overflow-y-auto px-1.5 pb-2">
        {toc.length === 0 ? (
          <div className="px-4 py-2 text-xs text-muted-foreground">{t("toc.empty")}</div>
        ) : (
          toc.map((item, i) => (
            <TocNode
              key={i}
              item={item}
              path={[i]}
              currentHref={currentHref}
              expanded={expanded}
              onToggle={onToggle}
              onGoTo={onGoTo}
              listRef={listRef}
              guideProgress={guideProgress}
            />
          ))
        )}
      </div>
    </nav>
  );
}
