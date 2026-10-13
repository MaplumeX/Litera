import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Check, CloudOff, Star } from "lucide-react";
import type { BookRecord, ReadingStatus } from "@/types/library";
import { BookStatusMenu } from "@/components/BookStatusMenu";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  formatLibraryTimestamp,
  progressPercent,
  withCoverRevision,
  type LibraryStatusFilter,
} from "@/lib/library-shelf";
import {
  BookActionContext,
  BookActionDropdown,
  type BookActionHandlers,
} from "@/components/BookActionsMenu";

interface BookCardProps {
  book: BookRecord;
  onOpen: (bookId: string) => void | Promise<void>;
  onDelete: (bookId: string) => void;
  onDetails: (book: BookRecord) => void;
  onToggleStar?: (book: BookRecord) => void;
  onChangeStatus?: (book: BookRecord, status: ReadingStatus) => void;
  opening?: boolean;
  deleteDisabled?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (bookId: string) => void;
  openDisabled?: boolean;
  /** Enter select mode with this book already selected. */
  onEnterSelect?: (bookId: string) => void;
  coverRev?: number;
  /** The shelf's active filter, so the status chip does not repeat it. */
  statusFilter?: LibraryStatusFilter;
}

function coverUrl(path: string, coverRev?: number): string {
  return withCoverRevision(convertFileSrc(path), coverRev);
}

function BookCoverImage({
  book,
  coverRev,
  small = false,
}: {
  book: BookRecord;
  coverRev?: number;
  /** Thumbnail slot: the initial-letter fallback scales down to fit. */
  small?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = book.coverPath ? coverUrl(book.coverPath, coverRev) : null;
  const showCover = src && failedSrc !== src;
  const initial = book.title.charAt(0) || "?";

  if (showCover) {
    return (
      <img
        src={src}
        alt={book.title}
        className="h-full w-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <span
        className={cn(
          "font-medium text-muted-foreground/40",
          small ? "text-sm" : "text-4xl",
        )}
      >
        {initial}
      </span>
    </div>
  );
}

/** Bind the shelf's per-book callbacks to one book for its menus. */
function bookActions(
  book: BookRecord,
  handlers: {
    onOpen: (bookId: string) => void | Promise<void>;
    onDetails: (book: BookRecord) => void;
    onDelete: (bookId: string) => void;
    deleteDisabled: boolean;
    onToggleStar?: (book: BookRecord) => void;
    onChangeStatus?: (book: BookRecord, status: ReadingStatus) => void;
    onEnterSelect?: (bookId: string) => void;
  },
): BookActionHandlers {
  const { onToggleStar, onChangeStatus, onEnterSelect } = handlers;
  return {
    onOpen: () => {
      void handlers.onOpen(book.id);
    },
    onDetails: () => handlers.onDetails(book),
    onDelete: () => handlers.onDelete(book.id),
    deleteDisabled: handlers.deleteDisabled,
    readingStatus: book.readingStatus,
    starred: book.starred === true,
    onToggleStar: onToggleStar && (() => onToggleStar(book)),
    onChangeStatus: onChangeStatus && ((choice) => onChangeStatus(book, choice)),
    onSelect: onEnterSelect && (() => onEnterSelect(book.id)),
  };
}

export function BookCard({
  book,
  onOpen,
  onDelete,
  onDetails,
  onToggleStar,
  onChangeStatus,
  opening = false,
  deleteDisabled = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
  openDisabled = false,
  onEnterSelect,
  coverRev,
  statusFilter,
}: BookCardProps) {
  const { t } = useT();
  const pct = progressPercent(book.lastFraction);
  const uncached = book.cached === false;
  const starred = book.starred === true;
  const actions = bookActions(book, {
    onOpen,
    onDetails,
    onDelete,
    deleteDisabled,
    onToggleStar,
    onChangeStatus,
    onEnterSelect,
  });

  const card = (
    <div className="group relative flex flex-col gap-2">
      <button
        type="button"
        className={cn(
          "relative aspect-[2/3] w-full overflow-hidden rounded-cover bg-muted shadow-cover transition-[box-shadow,transform,opacity] duration-200 hover:shadow-cover-hover active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
          selectMode && selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
        onClick={(e) => {
          if (selectMode) {
            onToggleSelect?.(book.id);
            return;
          }
          // Ctrl/⌘-click starts a selection, as in a file manager.
          if ((e.ctrlKey || e.metaKey) && onEnterSelect) {
            onEnterSelect(book.id);
            return;
          }
          void onOpen(book.id);
        }}
        disabled={(opening || openDisabled) && !selectMode}
        title={book.title}
        aria-pressed={selectMode ? selected : undefined}
      >
        <BookCoverImage book={book} coverRev={coverRev} />
        {uncached && !selectMode && (
          <span
            role="img"
            className="absolute left-1.5 top-1.5 flex items-center rounded-sm bg-background/85 p-1 text-muted-foreground"
            title={t("library.notCached")}
            aria-label={t("library.notCached")}
          >
            <CloudOff className="size-3" aria-hidden />
          </span>
        )}
        {pct != null && !opening && (
          <>
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/15">
              <span
                className="block h-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-background/80 px-1 py-px text-[10px] font-medium tabular-nums text-foreground/80 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
              {pct}%
            </span>
          </>
        )}
        {opening && !selectMode && (
          <span className="absolute inset-x-0 bottom-0 bg-background/90 px-2 py-1 text-xs font-medium">
            {t("library.opening")}
          </span>
        )}
        {selectMode && (
          <span
            className={cn(
              "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-sm border border-background/80",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-background/80 text-transparent",
            )}
          >
            <Check className="size-3" />
          </span>
        )}
      </button>

      {!selectMode && (
        <div className="absolute right-1 top-1 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-state=open]]:opacity-100 motion-reduce:transition-none">
          <BookActionDropdown
            className="h-6 w-6 border border-border/80 bg-background"
            {...actions}
          />
        </div>
      )}

      <div className="px-1">
        <div className="flex items-start gap-1">
          <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-tight">
            {book.title}
          </p>
          {!selectMode && onToggleStar && (
            <button
              type="button"
              className={cn(
                "shrink-0 rounded-sm p-0.5 text-muted-foreground transition-[color,opacity] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
                starred
                  ? "text-foreground"
                  : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
              aria-label={t(starred ? "library.unstar" : "library.star")}
              aria-pressed={starred}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(book);
              }}
            >
              <Star className={cn("size-3.5", starred && "fill-current")} />
            </button>
          )}
        </div>
        {book.author && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {book.author}
          </p>
        )}
        {!selectMode && onChangeStatus && (
          <BookStatusMenu
            book={book}
            onChange={(choice) => onChangeStatus(book, choice)}
            statusFilter={statusFilter}
            className="mt-1"
          />
        )}
      </div>
    </div>
  );

  if (selectMode) return card;
  return <BookActionContext {...actions}>{card}</BookActionContext>;
}

interface BookListRowProps {
  book: BookRecord;
  onOpen: (bookId: string) => void | Promise<void>;
  onDelete: (bookId: string) => void;
  onDetails: (book: BookRecord) => void;
  onToggleStar?: (book: BookRecord) => void;
  onChangeStatus?: (book: BookRecord, status: ReadingStatus) => void;
  opening?: boolean;
  deleteDisabled?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (bookId: string) => void;
  openDisabled?: boolean;
  /** Enter select mode with this book already selected. */
  onEnterSelect?: (bookId: string) => void;
  coverRev?: number;
  statusFilter?: LibraryStatusFilter;
  /** Reserve the "not downloaded" column; the shelf sets it for every row or none. */
  cacheColumn?: boolean;
}

export function BookListRow({
  book,
  onOpen,
  onDelete,
  onDetails,
  onToggleStar,
  onChangeStatus,
  opening = false,
  deleteDisabled = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
  openDisabled = false,
  onEnterSelect,
  coverRev,
  statusFilter,
  cacheColumn = book.cached === false,
}: BookListRowProps) {
  const { t, locale } = useT();
  const pct = progressPercent(book.lastFraction);
  const uncached = book.cached === false;
  const starred = book.starred === true;
  const actions = bookActions(book, {
    onOpen,
    onDetails,
    onDelete,
    deleteDisabled,
    onToggleStar,
    onChangeStatus,
    onEnterSelect,
  });

  const row = (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/70",
        selectMode && selected && "ring-1 ring-primary",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={(e) => {
          if (selectMode) {
            onToggleSelect?.(book.id);
            return;
          }
          // Ctrl/⌘-click starts a selection, as in a file manager.
          if ((e.ctrlKey || e.metaKey) && onEnterSelect) {
            onEnterSelect(book.id);
            return;
          }
          void onOpen(book.id);
        }}
        disabled={(opening || openDisabled) && !selectMode}
        aria-pressed={selectMode ? selected : undefined}
      >
        {selectMode && (
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-background text-transparent",
            )}
          >
            <Check className="size-3" />
          </span>
        )}
        <span className="h-14 w-10 shrink-0 overflow-hidden rounded-cover bg-muted shadow-cover">
          <BookCoverImage book={book} coverRev={coverRev} small />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{book.title}</span>
          {book.author ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {book.author}
            </span>
          ) : null}
        </span>
        {/* Always rendered so rows keep their columns aligned when a book has
            no series. */}
        <span
          className="hidden w-32 shrink-0 truncate text-right text-xs text-muted-foreground md:block"
          title={book.series || undefined}
        >
          {book.series}
        </span>
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {pct == null ? t("library.noProgress") : `${pct}%`}
        </span>
        {cacheColumn && (
          <span
            data-cache-cell
            className="flex w-20 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground"
            title={uncached ? t("library.notCached") : undefined}
          >
            {uncached && (
              <>
                <CloudOff className="size-3" aria-hidden />
                {t("library.notCached")}
              </>
            )}
          </span>
        )}
        <span className="hidden w-36 shrink-0 truncate text-right text-xs text-muted-foreground md:block">
          {book.lastOpenedAt
            ? formatLibraryTimestamp(book.lastOpenedAt, locale)
            : t("library.neverOpened")}
        </span>
      </button>
      {!selectMode && onChangeStatus && (
        <BookStatusMenu
          book={book}
          onChange={(choice) => onChangeStatus(book, choice)}
          statusFilter={statusFilter}
        />
      )}
      {!selectMode && onToggleStar && (
        <button
          type="button"
          className={cn(
            "shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            starred
              ? "text-foreground"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          aria-label={t(starred ? "library.unstar" : "library.star")}
          aria-pressed={starred}
          onClick={() => onToggleStar(book)}
        >
          <Star className={cn("size-3.5", starred && "fill-current")} />
        </button>
      )}
      {!selectMode && <BookActionDropdown {...actions} />}
    </div>
  );

  if (selectMode) return row;
  return <BookActionContext {...actions}>{row}</BookActionContext>;
}

/**
 * A Continue reading tile: the cover and the progress to resume from. It is
 * never shown in select mode, so it carries no selection state.
 */
export function BookResumeTile({
  book,
  onOpen,
  onDelete,
  onDetails,
  onToggleStar,
  onChangeStatus,
  opening = false,
  deleteDisabled = false,
  openDisabled = false,
  onEnterSelect,
  coverRev,
}: BookCardProps) {
  const { t } = useT();
  const pct = progressPercent(book.lastFraction);
  const actions = bookActions(book, {
    onOpen,
    onDetails,
    onDelete,
    deleteDisabled,
    onToggleStar,
    onChangeStatus,
    onEnterSelect,
  });

  return (
    <BookActionContext {...actions}>
      <div className="group relative w-24 shrink-0">
        <button
          type="button"
          title={book.title}
          className="flex w-full flex-col gap-1.5 text-left disabled:opacity-60"
          onClick={() => {
            void onOpen(book.id);
          }}
          disabled={opening || openDisabled}
        >
          <span className="block aspect-[2/3] w-full overflow-hidden rounded-cover bg-muted shadow-cover transition-[box-shadow,transform] duration-200 group-hover:shadow-cover-hover group-active:scale-[0.98] motion-reduce:transition-none motion-reduce:group-active:scale-100">
            <BookCoverImage book={book} coverRev={coverRev} />
          </span>
          <span className="block truncate text-xs font-medium">{book.title}</span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
              <span
                className="block h-full bg-primary"
                style={{ width: `${pct ?? 0}%` }}
              />
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {opening
                ? t("library.opening")
                : pct == null
                  ? t("library.noProgress")
                  : `${pct}%`}
            </span>
          </span>
        </button>
        <div className="absolute right-1 top-1 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-state=open]]:opacity-100 motion-reduce:transition-none">
          <BookActionDropdown
            className="h-6 w-6 border border-border/80 bg-background"
            {...actions}
          />
        </div>
      </div>
    </BookActionContext>
  );
}
