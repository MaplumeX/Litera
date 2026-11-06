import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { BookRecord } from "@/types/library";
import { BookCoverImage } from "@/components/BookCard";
import { BookActionContext, type BookActionHandlers } from "@/components/BookActionsMenu";
import { paletteStyle, useCoverPalette } from "@/lib/cover-palette";
import { formatLibraryTimestamp, progressPercent, withCoverRevision } from "@/lib/library-shelf";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ProgressRail } from "@/mobile/MobileBookItems";
import { rememberCoverOrigin } from "@/mobile/page-transition";

interface MobileContinueHeroProps {
  /** The Books in progress, the one last read first. */
  books: readonly BookRecord[];
  actionsFor: (book: BookRecord) => BookActionHandlers;
  coverRev: Record<string, number>;
  openingBookId: string | null;
  disabled: boolean;
}

/**
 * The top of the phone's shelf, as on the desktop: the Book last read, lit in
 * its cover's colour, and under it every Book in progress as a small cover.
 * Touch has no hover to preview with, so a tap on a small cover shows that
 * Book in the card and a second tap opens it; the covers never move, so a tap
 * always lands on the one aimed at.
 */
export function MobileContinueHero({ books, actionsFor, coverRev, openingBookId, disabled }: MobileContinueHeroProps) {
  const { t, locale } = useT();
  const sectionRef = useRef<HTMLElement>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  // Falls back to the first when the shown Book leaves the list.
  const shown = books.find((book) => book.id === shownId) ?? books[0];
  const shownCover = shown.coverPath
    ? withCoverRevision(convertFileSrc(shown.coverPath), coverRev[shown.id])
    : null;
  const palette = useCoverPalette(shownCover, shown.title);
  const pct = progressPercent(shown.lastFraction);
  const opening = openingBookId === shown.id;
  const shownActions = actionsFor(shown);
  const meta = [shown.author, shown.lastOpenedAt && formatLibraryTimestamp(shown.lastOpenedAt, locale)].filter(
    Boolean,
  );

  const open = (actions: BookActionHandlers) => {
    // The big cover is the section's first: the open transition grows from it.
    if (sectionRef.current) rememberCoverOrigin(sectionRef.current);
    actions.onOpen();
  };

  return (
    <section
      ref={sectionRef}
      data-shelf="recent"
      aria-label={t("library.continueReading")}
      style={paletteStyle(palette)}
      className="cover-ambient mx-4 rounded-3xl p-4"
    >
      <div className="flex gap-4">
        <BookActionContext {...shownActions}>
          <button
            type="button"
            title={shown.title}
            disabled={opening || disabled}
            onClick={() => open(shownActions)}
            className="relative block w-24 shrink-0 self-start transition-transform duration-150 active:scale-[0.97] disabled:opacity-70 motion-reduce:transition-none"
          >
            <span
              data-book-cover={shown.id}
              className="relative block aspect-[2/3] w-full overflow-hidden rounded-cover shadow-[0_2px_4px_rgb(0_0_0/30%),0_12px_28px_rgb(0_0_0/40%)]"
            >
              <BookCoverImage book={shown} coverRev={coverRev[shown.id]} />
            </span>
          </button>
        </BookActionContext>

        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-xs font-medium text-white/70">{t("library.continueReading")}</h2>
          {/* Two lines held either way, so switching Books never moves the covers under the thumb. */}
          <p className="mt-1 line-clamp-2 min-h-[2lh] text-xl leading-tight font-semibold tracking-[-0.02em]">
            {shown.title}
          </p>
          {meta.length > 0 && <p className="mt-1 truncate text-[0.8125rem] text-white/75">{meta.join(" · ")}</p>}
          <div className="mt-auto flex items-center gap-2 pt-3">
            <ProgressRail pct={pct ?? 0} className="flex-1" onColor />
            <span className="shrink-0 text-xs text-white/85 tabular-nums">
              {opening ? t("library.opening") : pct == null ? t("library.noProgress") : `${pct}%`}
            </span>
          </div>
          <button
            type="button"
            disabled={opening || disabled}
            onClick={() => open(shownActions)}
            className="mt-3 h-10 self-start rounded-full bg-white px-5 text-sm font-medium text-zinc-900 transition-colors active:bg-white/85 disabled:opacity-70 motion-reduce:transition-none"
          >
            {t("library.resume")}
          </button>
        </div>
      </div>

      {books.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pt-2 pb-1.5 no-scrollbar">
          {books.map((book) => {
            const isShown = book.id === shown.id;
            const actions = actionsFor(book);
            return (
              <BookActionContext key={book.id} {...actions}>
                <button
                  type="button"
                  title={book.title}
                  aria-pressed={isShown}
                  disabled={openingBookId === book.id || disabled}
                  onClick={() => (isShown ? open(actions) : setShownId(book.id))}
                  className={cn(
                    "relative block aspect-[2/3] w-11 shrink-0 overflow-hidden rounded-cover shadow-[0_2px_8px_rgb(0_0_0/35%)] transition-[opacity,transform] duration-200 active:scale-95 motion-reduce:transition-none",
                    isShown ? "-translate-y-0.5 opacity-100 outline-2 outline-offset-2 outline-white" : "opacity-70",
                  )}
                >
                  <BookCoverImage book={book} coverRev={coverRev[book.id]} small />
                </button>
              </BookActionContext>
            );
          })}
        </div>
      )}
    </section>
  );
}
