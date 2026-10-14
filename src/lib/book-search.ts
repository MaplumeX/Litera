/** One match of a find-in-book query, with its surrounding text. */
export interface BookSearchHit {
  cfi: string;
  pre: string;
  match: string;
  post: string;
}

/** Matches from one section, labelled with the chapter they fall in. */
export interface BookSearchGroup {
  label: string;
  hits: BookSearchHit[];
}

export interface BookSearchResults {
  groups: BookSearchGroup[];
  total: number;
  /** Share of the book scanned so far, 0–1. */
  progress: number;
  /** Stopped at the hit limit; the rest of the book was not scanned. */
  truncated: boolean;
}

/** A common word can match thousands of times; past this the list stops helping. */
export const BOOK_SEARCH_HIT_LIMIT = 1000;

export const EMPTY_SEARCH_RESULTS: BookSearchResults = {
  groups: [],
  total: 0,
  progress: 0,
  truncated: false,
};

interface RawExcerpt {
  pre?: unknown;
  match?: unknown;
  post?: unknown;
}

function toHit(item: unknown): BookSearchHit | null {
  if (item == null || typeof item !== "object") return null;
  const { cfi, excerpt } = item as { cfi?: unknown; excerpt?: RawExcerpt };
  if (typeof cfi !== "string") return null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return { cfi, pre: text(excerpt?.pre), match: text(excerpt?.match), post: text(excerpt?.post) };
}

/**
 * Fold one event from foliate's whole-book `view.search()` into the results:
 * `{ progress }` while scanning, `{ label, subitems }` per section with
 * matches, and the string `"done"` at the end.
 */
export function appendSearchEvent(
  results: BookSearchResults,
  event: unknown,
  limit = BOOK_SEARCH_HIT_LIMIT,
): BookSearchResults {
  if (event === "done") return { ...results, progress: 1 };
  if (event == null || typeof event !== "object") return results;
  const { progress, label, subitems } = event as {
    progress?: unknown;
    label?: unknown;
    subitems?: unknown;
  };
  if (typeof progress === "number") {
    return { ...results, progress: Math.max(results.progress, Math.min(1, progress)) };
  }
  if (!Array.isArray(subitems)) return results;
  const room = limit - results.total;
  if (room <= 0) return { ...results, truncated: true };
  const hits = subitems.map(toHit).filter((hit): hit is BookSearchHit => hit != null);
  if (hits.length === 0) return results;
  const kept = hits.slice(0, room);
  return {
    ...results,
    groups: [...results.groups, { label: typeof label === "string" ? label : "", hits: kept }],
    total: results.total + kept.length,
    truncated: results.truncated || kept.length < hits.length,
  };
}

export function flattenHits(groups: BookSearchGroup[]): BookSearchHit[] {
  return groups.flatMap((group) => group.hits);
}

/** The hit `step` places away from `activeCfi`, wrapping at both ends. */
export function stepHit(
  groups: BookSearchGroup[],
  activeCfi: string | null,
  step: 1 | -1,
): BookSearchHit | null {
  const hits = flattenHits(groups);
  if (hits.length === 0) return null;
  const index = activeCfi == null ? -1 : hits.findIndex((hit) => hit.cfi === activeCfi);
  if (index === -1) return step === 1 ? hits[0] : hits[hits.length - 1];
  return hits[(index + step + hits.length) % hits.length];
}
