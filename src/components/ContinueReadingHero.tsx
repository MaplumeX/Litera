import { convertFileSrc } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { BookActionContext } from "@/components/BookActionsMenu";
import { BookCoverImage, bookActions } from "@/components/BookCard";
import { Tip } from "@/components/ui/tooltip";
import { paletteStyle, useCoverPalette } from "@/lib/cover-palette";
import { useT } from "@/lib/i18n";
import {
  formatLibraryTimestamp,
  progressPercent,
  withCoverRevision,
} from "@/lib/library-shelf";
import type { BookRecord, ReadingStatus } from "@/types/library";

interface ContinueReadingHeroProps {
  books: readonly BookRecord[];
  coverRev: Record<string, number>;
  openingBookId: string | null;
  onOpen: (bookId: string) => void | Promise<void>;
  onDelete: (bookId: string) => void;
  onDetails: (book: BookRecord) => void;
  onToggleStar?: (book: BookRecord) => void;
  onChangeStatus?: (book: BookRecord, status: ReadingStatus) => void;
  onEnterSelect?: (bookId: string) => void;
  deleteDisabled?: boolean;
  openDisabled?: boolean;
}

/**
 * The top of the shelf: the Book last read, lit in its cover's colour, and the
 * others in progress beside it. The card always shows the Book last read; the
 * others open with a click and take its place by being read, never by hover,
 * so what the card shows is always what its Resume button opens.
 */
export function ContinueReadingHero({
  books,
  coverRev,
  openingBookId,
  onOpen,
  onDelete,
  onDetails,
  onToggleStar,
  onChangeStatus,
  onEnterSelect,
  deleteDisabled = false,
  openDisabled = false,
}: ContinueReadingHeroProps) {
  const { t, locale } = useT();
  const shown = books[0];
  const shownCover = shown.coverPath
    ? withCoverRevision(convertFileSrc(shown.coverPath), coverRev[shown.id])
    : null;
  const palette = useCoverPalette(shownCover, shown.title);
  const pct = progressPercent(shown.lastFraction);
  const opening = openingBookId === shown.id;
  const others = books.slice(1);
  const actionsFor = (book: BookRecord) =>
    bookActions(book, {
      onOpen,
      onDetails,
      onDelete,
      deleteDisabled,
      onToggleStar,
      onChangeStatus,
      onEnterSelect,
    });
  const meta = [
    shown.author,
    shown.lastOpenedAt && formatLibraryTimestamp(shown.lastOpenedAt, locale),
  ].filter(Boolean);

  return (
    <section
      data-shelf="recent"
      className="cover-ambient flex flex-wrap items-center gap-x-7 gap-y-5 rounded-xl p-5 sm:p-7"
      style={paletteStyle(palette)}
    >
      <BookActionContext {...actionsFor(shown)}>
        <button
          type="button"
          aria-label={shown.title}
          disabled={opening || openDisabled}
          onClick={() => void onOpen(shown.id)}
          className="relative block aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-cover shadow-[0_2px_4px_rgb(0_0_0/30%),0_18px_40px_rgb(0_0_0/40%)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-70 motion-reduce:transition-none sm:w-28"
        >
          <BookCoverImage book={shown} coverRev={coverRev[shown.id]} />
        </button>
      </BookActionContext>

      <div className="min-w-48 flex-1">
        <h2 className="text-xs font-medium text-white/70">{t("library.continueReading")}</h2>
        <p className="mt-1 line-clamp-2 text-2xl leading-tight font-semibold tracking-[-0.022em] sm:text-[1.75rem]">
          {shown.title}
        </p>
        {meta.length > 0 && <p className="mt-1 truncate text-sm text-white/75">{meta.join(" · ")}</p>}
        <div className="mt-4 flex max-w-md items-center gap-3">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
            <span
              className="block h-full rounded-full bg-white transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${pct ?? 0}%` }}
            />
          </span>
          <span className="shrink-0 text-xs text-white/85 tabular-nums">
            {opening ? t("library.opening") : pct == null ? t("library.noProgress") : `${pct}%`}
          </span>
        </div>
        <Button
          size="sm"
          className="mt-4 bg-white text-zinc-900 hover:bg-white/90 focus-visible:ring-white/50"
          disabled={opening || openDisabled}
          onClick={() => void onOpen(shown.id)}
        >
          {t("library.resume")}
        </Button>
      </div>

      {others.length > 0 && (
        <div className="flex shrink-0 gap-2.5">
          {others.map((book) => {
            const bookPct = progressPercent(book.lastFraction);
            return (
              <BookActionContext key={book.id} {...actionsFor(book)}>
                <Tip label={bookPct == null ? book.title : `${book.title} · ${bookPct}%`}>
                  <button
                    type="button"
                    aria-label={book.title}
                    disabled={openingBookId === book.id || openDisabled}
                    onClick={() => void onOpen(book.id)}
                    className="relative block aspect-[2/3] w-11 overflow-hidden rounded-cover opacity-80 shadow-[0_2px_8px_rgb(0_0_0/35%)] transition-[opacity,transform] duration-200 hover:-translate-y-0.5 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none sm:w-14"
                  >
                    <BookCoverImage book={book} coverRev={coverRev[book.id]} small />
                    {bookPct != null && (
                      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-black/30">
                        <span className="block h-full bg-white" style={{ width: `${bookPct}%` }} />
                      </span>
                    )}
                  </button>
                </Tip>
              </BookActionContext>
            );
          })}
        </div>
      )}
    </section>
  );
}
