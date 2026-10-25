import { CloudOff, Star } from "lucide-react";
import type { BookRecord } from "@/types/library";
import { BookCoverImage } from "@/components/BookCard";
import {
  BookActionContext,
  BookActionDropdown,
  type BookActionHandlers,
} from "@/components/BookActionsMenu";
import { progressPercent } from "@/lib/library-shelf";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { rememberCoverOrigin } from "@/mobile/page-transition";

interface MobileBookItemProps {
  book: BookRecord;
  /** The Book's actions, shown as a sheet on long-press (and ⋮ in a row). */
  actions: BookActionHandlers;
  opening: boolean;
  disabled: boolean;
  coverRev?: number;
}

/** "35% read", "Finished" or "Not started": the one line under a cover. */
export function useProgressCaption(book: BookRecord, opening: boolean): string {
  const { t } = useT();
  if (opening) return t("library.opening");
  if (book.readingStatus === "finished") return t("library.status.finished");
  const pct = progressPercent(book.lastFraction);
  return pct ? t("mobile.readPct", { pct }) : t("mobile.notStarted");
}

function ProgressRail({ pct, className }: { pct: number; className?: string }) {
  return (
    <span className={cn("block h-1 overflow-hidden rounded-full bg-foreground/10", className)}>
      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Not on this phone yet (Sync): the file downloads when the Book opens. */
function NotCachedBadge() {
  const { t } = useT();
  return (
    <span
      role="img"
      aria-label={t("library.notCached")}
      className="absolute top-1.5 left-1.5 flex items-center rounded-full bg-background/85 p-1 text-muted-foreground"
    >
      <CloudOff className="size-3" aria-hidden />
    </span>
  );
}

function StarBadge() {
  const { t } = useT();
  return (
    <span
      role="img"
      aria-label={t("library.status.starred")}
      className="absolute top-1.5 right-1.5 flex items-center rounded-full bg-background/85 p-1 text-foreground"
    >
      <Star className="size-3 fill-current" aria-hidden />
    </span>
  );
}

/** A grid cell: the cover, the title under it and how far along the Book is. */
export function MobileBookTile({ book, actions, opening, disabled, coverRev }: MobileBookItemProps) {
  const caption = useProgressCaption(book, opening);
  const pct = progressPercent(book.lastFraction);
  return (
    <BookActionContext {...actions}>
      <button
        type="button"
        title={book.title}
        className="flex w-full min-w-0 flex-col gap-1.5 text-left disabled:opacity-60"
        onClick={(event) => {
          rememberCoverOrigin(event.currentTarget);
          actions.onOpen();
        }}
        disabled={opening || disabled}
      >
        <span
          data-book-cover={book.id}
          className="relative block aspect-[2/3] w-full overflow-hidden rounded-cover bg-muted shadow-cover transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none"
        >
          <BookCoverImage book={book} coverRev={coverRev} />
          {book.cached === false && <NotCachedBadge />}
          {book.starred && <StarBadge />}
          {pct != null && pct > 0 && book.readingStatus !== "finished" && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/15">
              <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
        <span className="line-clamp-2 min-h-[2.25rem] text-[0.8125rem] leading-[1.125rem] font-medium">{book.title}</span>
        <span className="-mt-1 truncate text-[0.6875rem] text-muted-foreground tabular-nums">{caption}</span>
      </button>
    </BookActionContext>
  );
}

/** A list row: thumbnail, title and author, progress, and ⋮ for the actions. */
export function MobileBookRow({ book, actions, opening, disabled, coverRev }: MobileBookItemProps) {
  const caption = useProgressCaption(book, opening);
  const pct = progressPercent(book.lastFraction) ?? 0;
  return (
    <BookActionContext {...actions}>
      <div className="flex items-center gap-1 pr-1 transition-colors active:bg-foreground/5">
        <button
          type="button"
          title={book.title}
          className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-4 text-left disabled:opacity-60"
          onClick={(event) => {
            rememberCoverOrigin(event.currentTarget);
            actions.onOpen();
          }}
          disabled={opening || disabled}
        >
          <span
            data-book-cover={book.id}
            className="relative block h-[4.5rem] w-12 shrink-0 overflow-hidden rounded-cover bg-muted shadow-cover"
          >
            <BookCoverImage book={book} coverRev={coverRev} small />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="truncate text-[0.9375rem] font-medium">{book.title}</span>
              {book.starred && <Star className="size-3.5 shrink-0 fill-current" aria-hidden />}
              {book.cached === false && (
                <CloudOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </span>
            {book.author && (
              <span className="mt-0.5 block truncate text-[0.8125rem] text-muted-foreground">{book.author}</span>
            )}
            <span className="mt-2 flex items-center gap-2">
              <ProgressRail pct={pct} className="w-20" />
              <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{caption}</span>
            </span>
          </span>
        </button>
        <BookActionDropdown className="size-10 rounded-full [&_svg]:size-5" {...actions} />
      </div>
    </BookActionContext>
  );
}

/**
 * A "Continue reading" card: the Book you were in, big enough to tap
 * without looking, with where you left off.
 */
export function MobileResumeCard({ book, actions, opening, disabled, coverRev }: MobileBookItemProps) {
  const { t } = useT();
  const pct = progressPercent(book.lastFraction) ?? 0;
  return (
    <BookActionContext {...actions}>
      <button
        type="button"
        title={book.title}
        className="flex w-full items-center gap-4 rounded-2xl bg-card p-3 text-left shadow-soft transition-transform duration-150 active:scale-[0.99] disabled:opacity-60 motion-reduce:transition-none"
        onClick={(event) => {
          rememberCoverOrigin(event.currentTarget);
          actions.onOpen();
        }}
        disabled={opening || disabled}
      >
        <span
          data-book-cover={book.id}
          className="relative block h-24 w-16 shrink-0 overflow-hidden rounded-cover bg-muted shadow-cover"
        >
          <BookCoverImage book={book} coverRev={coverRev} small />
        </span>
        <span className="flex min-w-0 flex-1 flex-col self-stretch py-0.5">
          <span className="line-clamp-2 text-[0.9375rem] leading-5 font-medium">{book.title}</span>
          {book.author && (
            <span className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">{book.author}</span>
          )}
          <span className="mt-auto flex items-center gap-2 pt-2">
            <ProgressRail pct={pct} className="flex-1" />
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {opening ? t("library.opening") : `${pct}%`}
            </span>
          </span>
        </span>
      </button>
    </BookActionContext>
  );
}
