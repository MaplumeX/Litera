import { useEffect, useRef, type RefObject } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { TocItem } from "@/components/ReaderView";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { tocPathKey } from "@/lib/toc-items";
import { cn } from "@/lib/utils";

interface TocSidebarProps {
  toc: TocItem[];
  currentHref?: string;
  expanded: string[];
  onToggle: (key: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onGoTo: (href: string) => void;
}

function TocNode({
  item,
  path,
  currentHref,
  expanded,
  onToggle,
  onGoTo,
  listRef,
}: {
  item: TocItem;
  path: number[];
  currentHref?: string;
  expanded: string[];
  onToggle: (key: string) => void;
  onGoTo: (href: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
}) {
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
          "flex w-full items-center rounded px-2 py-1.5 text-sm",
          isCurrent
            ? "bg-accent font-medium text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
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
            />
          ))
        : null}
    </>
  );
}

export function TocSidebar({
  toc,
  currentHref,
  expanded,
  onToggle,
  onExpandAll,
  onCollapseAll,
  onGoTo,
}: TocSidebarProps) {
  const { t } = useT();
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <nav className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center border-b px-3 text-sm font-medium">
        {t("toc.title")}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("toc.expandAll")}
            onClick={onExpandAll}
          >
            <ChevronsUpDown />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("toc.collapseAll")}
            onClick={onCollapseAll}
          >
            <ChevronsDownUp />
          </Button>
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto py-2">
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
            />
          ))
        )}
      </div>
    </nav>
  );
}
