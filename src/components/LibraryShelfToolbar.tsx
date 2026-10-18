import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  LayoutGrid,
  List,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { READING_STATUSES, STATUS_LABEL_KEYS } from "@/components/BookStatusMenu";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  isLibrarySortOrder,
  type LibrarySortKey,
  type LibrarySortOrder,
  type LibraryStatusFilter,
} from "@/lib/library-shelf";
import type { LibraryViewMode } from "@/lib/library-shelf-prefs";
import type { ReadingStatus } from "@/types/library";

export const SORT_OPTIONS: { value: LibrarySortKey; labelKey: MessageKey }[] = [
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

// No rule underneath: the page title and the shelf below it share one surface.
const TOOLBAR_CLASS = "flex h-12 shrink-0 items-center gap-2 px-6";

const SEGMENT_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none [&_svg]:size-4";

interface LibraryShelfToolbarProps {
  statusFilter: LibraryStatusFilter;
  /** Books on the shelf under the current search and filter. */
  count: number;
  searching: boolean;
  sort: LibrarySortKey;
  onSortChange: (value: string) => void;
  order: LibrarySortOrder;
  onOrderChange: (order: LibrarySortOrder) => void;
  view: LibraryViewMode;
  onViewChange: (view: LibraryViewMode) => void;
}

/**
 * The header of the shelf column: what is shown on the left, as the page's
 * title, how it is ordered and laid out on the right. Filters live in the
 * sidebar, so this row only describes the current view.
 */
export function LibraryShelfToolbar({
  statusFilter,
  count,
  searching,
  sort,
  onSortChange,
  order,
  onOrderChange,
  view,
  onViewChange,
}: LibraryShelfToolbarProps) {
  const { t } = useT();
  const filterOption = STATUS_OPTIONS.find((option) => option.value === statusFilter);
  const sortOption = SORT_OPTIONS.find((option) => option.value === sort);
  const sortLabel = sortOption ? t(sortOption.labelKey) : "";
  const orderLabel = t(order === "asc" ? "library.orderAsc" : "library.orderDesc");
  return (
    <div className={TOOLBAR_CLASS}>
      <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">
        {filterOption && t(filterOption.labelKey)}
        <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
          {searching ? t("library.searchResults", { count }) : count}
        </span>
      </h2>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 font-normal text-muted-foreground hover:text-foreground"
              aria-label={`${t("library.sort")}: ${sortLabel}, ${orderLabel}`}
              data-sort-order={order}
            >
              {order === "asc" ? (
                <ArrowUpNarrowWide className="size-3.5" />
              ) : (
                <ArrowDownWideNarrow className="size-3.5" />
              )}
              {sortLabel}
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuRadioGroup value={sort} onValueChange={onSortChange}>
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={order}
              onValueChange={(value) => {
                if (isLibrarySortOrder(value)) onOrderChange(value);
              }}
            >
              <DropdownMenuRadioItem value="asc">
                {t("library.orderAsc")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">
                {t("library.orderDesc")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-0.5">
          {(
            [
              ["grid", "library.viewGrid", LayoutGrid],
              ["list", "library.viewList", List],
            ] as const
          ).map(([mode, labelKey, Icon]) => (
            <button
              key={mode}
              type="button"
              aria-label={t(labelKey)}
              aria-pressed={view === mode}
              onClick={() => onViewChange(mode)}
              className={cn(
                SEGMENT_CLASS,
                view === mode
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon />
            </button>
          ))}
        </div>
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
