import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Check, X } from "lucide-react";
import type { BookRecord } from "@/types/library";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  formatLibraryTimestamp,
  progressPercent,
  withCoverRevision,
} from "@/lib/library-shelf";
import {
  BookActionContext,
  BookActionDropdown,
} from "@/components/BookActionsMenu";

interface BookCardProps {
  book: BookRecord;
  onOpen: (bookId: string) => void | Promise<void>;
  onDelete: (bookId: string) => void;
  onDetails: (book: BookRecord) => void;
  opening?: boolean;
  deleteDisabled?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (bookId: string) => void;
  openDisabled?: boolean;
  showMenu?: boolean;
  showDelete?: boolean;
  coverRev?: number;
}

function coverUrl(path: string, coverRev?: number): string {
  return withCoverRevision(convertFileSrc(path), coverRev);
}

function BookCoverImage({
  book,
  coverRev,
  className,
}: {
  book: BookRecord;
  coverRev?: number;
  className?: string;
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
        className={cn("h-full w-full object-cover", className)}
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <span className="text-4xl font-medium text-muted-foreground/40">
        {initial}
      </span>
    </div>
  );
}

export function BookCard({
  book,
  onOpen,
  onDelete,
  onDetails,
  opening = false,
  deleteDisabled = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
  openDisabled = false,
  showMenu = true,
  showDelete = true,
  coverRev,
}: BookCardProps) {
  const { t } = useT();
  const pct = progressPercent(book.lastFraction);
  const actions = {
    onOpen: () => {
      void onOpen(book.id);
    },
    onDetails: () => onDetails(book),
    onDelete: () => onDelete(book.id),
  };

  const card = (
    <div className="group relative flex flex-col gap-2">
      <button
        type="button"
        className={cn(
          "relative aspect-[2/3] w-full overflow-hidden rounded-md border bg-muted transition-[border-color,transform,opacity] duration-200 hover:border-foreground/25 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
          selectMode && selected && "ring-1 ring-primary",
        )}
        onClick={() => {
          if (selectMode) {
            onToggleSelect?.(book.id);
            return;
          }
          void onOpen(book.id);
        }}
        disabled={(opening || openDisabled) && !selectMode}
        title={book.title}
        aria-pressed={selectMode ? selected : undefined}
      >
        <BookCoverImage book={book} coverRev={coverRev} />
        {pct != null && !opening && (
          <>
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/15">
              <span
                className="block h-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-background/80 px-1 py-px text-[10px] font-medium tabular-nums text-foreground/80">
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

      {showDelete && !selectMode && (
        <button
          type="button"
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground opacity-0 transition-opacity duration-200 hover:bg-muted hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(book.id);
          }}
          disabled={deleteDisabled}
          title={t("common.delete")}
          aria-label={t("common.delete")}
        >
          <X className="size-3.5" />
        </button>
      )}

      {showMenu && !selectMode && (
        <div className="absolute right-8 top-1 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 has-[:focus-visible]:opacity-100 motion-reduce:transition-none">
          <BookActionDropdown
            className="h-6 w-6 border border-border/80 bg-background"
            {...actions}
          />
        </div>
      )}

      <div className="px-1">
        <p className="line-clamp-2 text-sm font-medium leading-tight">
          {book.title}
        </p>
        {book.author && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {book.author}
          </p>
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
  opening?: boolean;
  deleteDisabled?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (bookId: string) => void;
  openDisabled?: boolean;
  coverRev?: number;
}

export function BookListRow({
  book,
  onOpen,
  onDelete,
  onDetails,
  opening = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
  openDisabled = false,
  coverRev,
}: BookListRowProps) {
  const { t, locale } = useT();
  const pct = progressPercent(book.lastFraction);
  const actions = {
    onOpen: () => {
      void onOpen(book.id);
    },
    onDetails: () => onDetails(book),
    onDelete: () => onDelete(book.id),
  };

  const row = (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md border px-2 py-2 transition-colors hover:bg-muted/40",
        selectMode && selected && "ring-1 ring-primary",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => {
          if (selectMode) {
            onToggleSelect?.(book.id);
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
        <span className="h-14 w-10 shrink-0 overflow-hidden rounded-sm border bg-muted">
          <BookCoverImage
            book={book}
            coverRev={coverRev}
            className="text-sm"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{book.title}</span>
          {book.author ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {book.author}
            </span>
          ) : null}
        </span>
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {pct == null ? t("library.noProgress") : `${pct}%`}
        </span>
        <span className="hidden w-36 shrink-0 truncate text-right text-xs text-muted-foreground md:block">
          {book.lastOpenedAt
            ? formatLibraryTimestamp(book.lastOpenedAt, locale)
            : t("library.neverOpened")}
        </span>
      </button>
      {!selectMode && <BookActionDropdown {...actions} />}
    </div>
  );

  if (selectMode) return row;
  return <BookActionContext {...actions}>{row}</BookActionContext>;
}
