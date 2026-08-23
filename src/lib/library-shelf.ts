import type { BookRecord } from "@/types/library";
import type { AppLocale } from "@/lib/i18n";

export const MAX_COVER_BYTES = 20 * 1024 * 1024;
export const RECENT_LIMIT = 4;

export type LibrarySortKey =
  | "recent"
  | "title"
  | "author"
  | "imported"
  | "progress";

function compareIgnoreCase(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareRecent(left: BookRecord, right: BookRecord): number {
  const leftOpened = left.lastOpenedAt;
  const rightOpened = right.lastOpenedAt;
  if (leftOpened && rightOpened) return rightOpened.localeCompare(leftOpened);
  if (leftOpened) return -1;
  if (rightOpened) return 1;
  return right.importedAt.localeCompare(left.importedAt);
}

function compareTitle(left: BookRecord, right: BookRecord): number {
  return compareIgnoreCase(left.title, right.title);
}

function compareAuthor(left: BookRecord, right: BookRecord): number {
  const leftEmpty = left.author.trim() === "";
  const rightEmpty = right.author.trim() === "";
  if (leftEmpty && rightEmpty) return compareTitle(left, right);
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  return compareIgnoreCase(left.author, right.author);
}

function compareImported(left: BookRecord, right: BookRecord): number {
  return right.importedAt.localeCompare(left.importedAt);
}

function compareProgress(left: BookRecord, right: BookRecord): number {
  const leftFrac = left.lastFraction;
  const rightFrac = right.lastFraction;
  if (leftFrac != null && rightFrac != null) return rightFrac - leftFrac;
  if (leftFrac != null) return -1;
  if (rightFrac != null) return 1;
  return compareRecent(left, right);
}

export function sortBooks(
  books: readonly BookRecord[],
  sort: LibrarySortKey,
): BookRecord[] {
  const copy = books.slice();
  const compare =
    sort === "title"
      ? compareTitle
      : sort === "author"
        ? compareAuthor
        : sort === "imported"
          ? compareImported
          : sort === "progress"
            ? compareProgress
            : compareRecent;
  copy.sort(compare);
  return copy;
}

export function takeRecent(
  books: readonly BookRecord[],
  limit = RECENT_LIMIT,
): BookRecord[] {
  return books
    .filter((book) => Boolean(book.lastOpenedAt))
    .sort((left, right) =>
      (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? ""),
    )
    .slice(0, limit);
}

export function filterBooks(
  books: readonly BookRecord[],
  query: string,
): BookRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return books.slice();
  return books.filter(
    (book) =>
      book.title.toLowerCase().includes(q) ||
      book.author.toLowerCase().includes(q),
  );
}

export function formatLibraryTimestamp(
  iso: string,
  locale: AppLocale,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function progressPercent(fraction: number | undefined): number | null {
  if (fraction == null) return null;
  return Math.round(fraction * 100);
}

/** Append a cache-busting query so convertFileSrc URLs reload after cover.jpg is replaced. */
export function withCoverRevision(src: string, rev?: number): string {
  if (!rev) return src;
  return `${src}${src.includes("?") ? "&" : "?"}v=${rev}`;
}
