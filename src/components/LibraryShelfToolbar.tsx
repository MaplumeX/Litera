import { Fragment } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  LayoutGrid,
  List,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { READING_STATUSES, STATUS_LABEL_KEYS } from "@/components/BookStatusMenu";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  LibrarySortKey,
  LibrarySortOrder,
  LibraryStatusFilter,
} from "@/lib/library-shelf";
import type { LibraryViewMode } from "@/lib/library-shelf-prefs";
import type { ReadingStatus } from "@/types/library";

const SORT_OPTIONS: { value: LibrarySortKey; labelKey: MessageKey }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "title", labelKey: "library.sort.title" },
  { value: "author", labelKey: "library.sort.author" },
  { value: "imported", labelKey: "library.sort.imported" },
  { value: "progress", labelKey: "library.sort.progress" },
];

export const STATUS_OPTIONS: { value: LibraryStatusFilter; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "library.status.all" },
  { value: "unread", labelKey: "library.status.unread" },
  { value: "reading", labelKey: "library.status.reading" },
  { value: "paused", labelKey: "library.status.paused" },
  { value: "finished", labelKey: "library.status.finished" },
  { value: "starred", labelKey: "library.status.starred" },
];

const TOOLBAR_CLASS = "flex h-10 shrink-0 items-center gap-2 border-b px-4";

interface LibraryShelfToolbarProps {
  statusFilter: LibraryStatusFilter;
  /** Per-filter counts over the current search result. */
  counts: Record<LibraryStatusFilter, number>;
  onStatusFilterChange: (value: string) => void;
  sort: LibrarySortKey;
  onSortChange: (value: string) => void;
  order: LibrarySortOrder;
  onOrderToggle: () => void;
  view: LibraryViewMode;
  onViewChange: (view: LibraryViewMode) => void;
  onEnterSelect: () => void;
  trashCount: number;
  onOpenTrash: () => void;
  busy: boolean;
}

/**
 * How the shelf is viewed: status tabs on the left, ordering and layout on the
 * right. The titlebar above keeps only global actions, so nothing there moves
 * when this row changes.
 */
export function LibraryShelfToolbar({
  statusFilter,
  counts,
  onStatusFilterChange,
  sort,
  onSortChange,
  order,
  onOrderToggle,
  view,
  onViewChange,
  onEnterSelect,
  trashCount,
  onOpenTrash,
  busy,
}: LibraryShelfToolbarProps) {
  const { t } = useT();
  return (
    <div className={TOOLBAR_CLASS}>
      <div
        role="group"
        aria-label={t("library.statusFilter")}
        className="hidden min-w-0 items-center gap-0.5 md:flex"
      >
        {STATUS_OPTIONS.map((option) => {
          const active = option.value === statusFilter;
          return (
            <Fragment key={option.value}>
              {/* Starred is orthogonal to Reading status, not a fifth status. */}
              {option.value === "starred" && (
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              )}
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onStatusFilterChange(option.value)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {option.value === "starred" && (
                  <Star className="size-3.5" aria-hidden />
                )}
                {t(option.labelKey)}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {counts[option.value]}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
      {/* Narrow windows cannot fit the tabs; the same choice as a dropdown. */}
      <div className="md:hidden">
        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger
            size="sm"
            className="h-7 w-[8.5rem]"
            aria-label={t("library.statusFilter")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)} {counts[option.value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Select value={sort} onValueChange={onSortChange}>
          <SelectTrigger
            size="sm"
            className="h-7 w-[8.75rem] border-transparent bg-transparent shadow-none hover:bg-muted/60 dark:bg-transparent"
            aria-label={t("library.sort")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={
            order === "asc"
              ? t("library.sortAscending")
              : t("library.sortDescending")
          }
          aria-pressed={order === "desc"}
          data-sort-order={order}
          onClick={onOrderToggle}
        >
          {order === "asc" ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
        </Button>
        <div className="flex items-center">
          <Button
            type="button"
            size="icon-sm"
            variant={view === "grid" ? "secondary" : "ghost"}
            aria-label={t("library.viewGrid")}
            aria-pressed={view === "grid"}
            onClick={() => onViewChange("grid")}
          >
            <LayoutGrid />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant={view === "list" ? "secondary" : "ghost"}
            aria-label={t("library.viewList")}
            aria-pressed={view === "list"}
            onClick={() => onViewChange("list")}
          >
            <List />
          </Button>
        </div>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button size="sm" variant="ghost" onClick={onEnterSelect} disabled={busy}>
          {t("library.select")}
        </Button>
        {/* Always present so its position is stable; an empty Trash opens
            the dialog's empty state. */}
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("library.trash")}
          data-trash-count={trashCount}
          onClick={onOpenTrash}
          disabled={busy}
        >
          <Trash2 />
          {trashCount > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {trashCount}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

interface LibrarySelectionBarProps {
  selectedCount: number;
  /** Every visible book is selected, so Select all has nothing to add. */
  allSelected: boolean;
  onSelectAll: () => void;
  /** Every selected book is starred, so the star action unstars instead. */
  allStarred: boolean;
  onToggleStar: () => void;
  onMarkAs: (status: ReadingStatus) => void;
  onDelete: () => void;
  onCancel: () => void;
  busy: boolean;
}

/** Stands in for the shelf toolbar while select mode is on. */
export function LibrarySelectionBar({
  selectedCount,
  allSelected,
  onSelectAll,
  allStarred,
  onToggleStar,
  onMarkAs,
  onDelete,
  onCancel,
  busy,
}: LibrarySelectionBarProps) {
  const { t } = useT();
  const none = selectedCount === 0;
  return (
    <div className={TOOLBAR_CLASS}>
      <span className="text-sm tabular-nums text-muted-foreground">
        {t("library.selectedCount", { count: selectedCount })}
      </span>
      <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={allSelected}>
        {t("library.selectAll")}
      </Button>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" disabled={none}>
            {t("library.markAs")}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {READING_STATUSES.map((status) => (
            <DropdownMenuItem key={status} onSelect={() => onMarkAs(status)}>
              {t(STATUS_LABEL_KEYS[status])}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" onClick={onToggleStar} disabled={none}>
        <Star className={cn(allStarred && !none && "fill-current")} />
        {t(allStarred && !none ? "library.unstar" : "library.star")}
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={none || busy}
          onClick={onDelete}
        >
          {t("common.delete")}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
