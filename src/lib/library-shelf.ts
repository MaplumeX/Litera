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

export type LibrarySortOrder = "asc" | "desc";

/** Comparator arithmetic: +1 keeps the primary comparison ascending. */
type Direction = 1 | -1;

const NATURAL_ORDER: Record<LibrarySortKey, LibrarySortOrder> = {
  recent: "desc",
  title: "asc",
  author: "asc",
  imported: "desc",
  progress: "desc",
};

/** Direction a sort key starts in: "Title" reads A→Z, "Recently opened" newest first. */
export function naturalOrderFor(key: LibrarySortKey): LibrarySortOrder {
  return NATURAL_ORDER[key];
}

export function isLibrarySortOrder(value: unknown): value is LibrarySortOrder {
  return value === "asc" || value === "desc";
}

function directionOf(order: LibrarySortOrder): Direction {
  return order === "asc" ? 1 : -1;
}

function compareIgnoreCase(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

/**
 * Only the primary comparison is affected by `direction`. Rules ("books with no
 * author go last") and tie-breakers ("then by title") keep their meaning, so
 * reversing a sort reorders real values without turning the fallbacks upside
 * down. Fallbacks therefore pass a fixed direction.
 */
function compareRecent(
  left: BookRecord,
  right: BookRecord,
  direction: Direction,
): number {
  const leftOpened = left.lastOpenedAt;
  const rightOpened = right.lastOpenedAt;
  if (leftOpened && rightOpened) {
    return direction * leftOpened.localeCompare(rightOpened);
  }
  if (leftOpened) return -1;
  if (rightOpened) return 1;
  return compareImported(left, right, -1);
}

function compareTitle(
  left: BookRecord,
  right: BookRecord,
  direction: Direction,
): number {
  return direction * compareIgnoreCase(left.title, right.title);
}

function compareAuthor(
  left: BookRecord,
  right: BookRecord,
  direction: Direction,
): number {
  const leftEmpty = left.author.trim() === "";
  const rightEmpty = right.author.trim() === "";
  if (leftEmpty && rightEmpty) return compareTitle(left, right, 1);
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  return direction * compareIgnoreCase(left.author, right.author);
}

function compareImported(
  left: BookRecord,
  right: BookRecord,
  direction: Direction,
): number {
  return direction * left.importedAt.localeCompare(right.importedAt);
}

function compareProgress(
  left: BookRecord,
  right: BookRecord,
  direction: Direction,
): number {
  const leftFrac = left.lastFraction;
  const rightFrac = right.lastFraction;
  if (leftFrac != null && rightFrac != null) {
    return direction * (leftFrac - rightFrac);
  }
  if (leftFrac != null) return -1;
  if (rightFrac != null) return 1;
  return compareRecent(left, right, -1);
}

/** One comparator per sort key, all taking the same direction parameter. */
type BookComparator = (
  left: BookRecord,
  right: BookRecord,
  direction: Direction,
) => number;

const SORT_COMPARATORS: Record<LibrarySortKey, BookComparator> = {
  recent: compareRecent,
  title: compareTitle,
  author: compareAuthor,
  imported: compareImported,
  progress: compareProgress,
};

export function sortBooks(
  books: readonly BookRecord[],
  sort: LibrarySortKey,
  order: LibrarySortOrder = naturalOrderFor(sort),
): BookRecord[] {
  const compare = SORT_COMPARATORS[sort];
  const direction = directionOf(order);
  const copy = books.slice();
  copy.sort((left, right) => compare(left, right, direction));
  return copy;
}

export type LibraryStatusFilter =
  | "all"
  | "unread"
  | "reading"
  | "finished"
  | "starred";

const STATUS_FILTERS: readonly LibraryStatusFilter[] = [
  "all",
  "unread",
  "reading",
  "finished",
  "starred",
];

export function isLibraryStatusFilter(
  value: unknown,
): value is LibraryStatusFilter {
  return (
    typeof value === "string" &&
    (STATUS_FILTERS as readonly string[]).includes(value)
  );
}

/**
 * Narrow the shelf to a reading status or the starred shortlist. `all` is a
 * pass-through so the filter composes with search and sorting unchanged.
 */
export function filterByStatus(
  books: readonly BookRecord[],
  filter: LibraryStatusFilter,
): BookRecord[] {
  if (filter === "all") return books.slice();
  if (filter === "starred") return books.filter((book) => book.starred === true);
  return books.filter((book) => book.readingStatus === filter);
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

/** Text fields a shelf search looks at. */
const SEARCHABLE_FIELDS = [
  "title",
  "author",
  "series",
  "publisher",
  "language",
  "description",
] as const;

/**
 * Tokenized search across every text field on a Book. The query splits on
 * whitespace and every token must appear in some field, so `penguin classics`
 * matches a book whose series is "Penguin Classics" and a token may be
 * satisfied by a different field than another one. Fields are joined with a
 * separator that can never occur inside a token so adjacent fields cannot
 * spell a match together. Absent optional fields are treated as empty.
 */
export function filterBooks(
  books: readonly BookRecord[],
  query: string,
): BookRecord[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return books.slice();
  return books.filter((book) => {
    const haystack = SEARCHABLE_FIELDS.map((field) => book[field] ?? "")
      .join("\n")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
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
