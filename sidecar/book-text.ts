/**
 * Pure helpers for chapter windowing and multi-query search merge.
 * Book loading / FTS live in book.ts; this file stays free of WASM so unit tests can import it.
 */

export const CHAPTER_PART_CHARS = 12000;
export const SEARCH_QUERY_CAP = 12;
export const SEARCH_HIT_LIMIT = 16;

const SNIPPET_RADIUS = 160;
const MAX_HITS_PER_CHAPTER_PER_QUERY = 3;
const DEDUPE_BUCKET_CHARS = 200;

export interface ChapterLike {
  title?: string;
  text: string;
}

export interface ChapterHit {
  chapterIndex: number;
  chapterTitle?: string;
  snippet: string;
  offset: number;
  match: "exact" | "partial";
}

export interface SearchToolHit {
  chapterIndex: number;
  chapterTitle?: string;
  part: number;
  match: "exact" | "partial";
  snippet: string;
}

export function cleanSearchQueries(queries: readonly string[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of queries) {
    const query = raw.trim();
    if (!query || seen.has(query)) continue;
    seen.add(query);
    cleaned.push(query);
    if (cleaned.length >= SEARCH_QUERY_CAP) break;
  }
  return cleaned;
}

export function windowChapterText(text: string, part = 0): {
  part: number;
  totalParts: number;
  text: string;
} {
  const totalParts = Math.max(1, Math.ceil(text.length / CHAPTER_PART_CHARS));
  const raw = Number.isFinite(part) ? Math.trunc(part) : 0;
  const window = Math.min(Math.max(0, raw), totalParts - 1);
  return {
    part: window,
    totalParts,
    text: text.slice(window * CHAPTER_PART_CHARS, (window + 1) * CHAPTER_PART_CHARS),
  };
}

export function snippetAround(text: string, offset: number, matchLength: number): string {
  const start = Math.max(0, offset - SNIPPET_RADIUS);
  const end = Math.min(text.length, offset + matchLength + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function tokenize(query: string): string[] {
  return query
    .split(/[\s,.。，！？!?；;：:、"'“”‘’()（）《》〈〉【】\[\]\-—…·]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function escapeFtsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export function toSearchToolHit(hit: ChapterHit): SearchToolHit {
  const result: SearchToolHit = {
    chapterIndex: hit.chapterIndex,
    part: Math.floor(hit.offset / CHAPTER_PART_CHARS),
    match: hit.match,
    snippet: hit.snippet,
  };
  if (hit.chapterTitle) result.chapterTitle = hit.chapterTitle;
  return result;
}

export function searchChapters(
  chapters: readonly ChapterLike[],
  queries: readonly string[],
  options?: {
    limit?: number;
    ftsCandidates?: (query: string) => number[];
  },
): ChapterHit[] {
  const cleanQueries = cleanSearchQueries(queries);
  const limit = options?.limit ?? SEARCH_HIT_LIMIT;
  if (!cleanQueries.length) return [];

  const exact: ChapterHit[] = [];
  const partial: ChapterHit[] = [];
  const seen = new Set<string>();
  const push = (list: ChapterHit[], hit: ChapterHit) => {
    const key = `${hit.chapterIndex}:${Math.floor(hit.offset / DEDUPE_BUCKET_CHARS)}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(hit);
  };

  for (const query of cleanQueries) {
    let queryHasExact = false;
    chapters.forEach((chapter, chapterIndex) => {
      let from = 0;
      for (let n = 0; n < MAX_HITS_PER_CHAPTER_PER_QUERY; n++) {
        const at = chapter.text.indexOf(query, from);
        if (at === -1) break;
        queryHasExact = true;
        push(exact, {
          chapterIndex,
          chapterTitle: chapter.title,
          snippet: snippetAround(chapter.text, at, query.length),
          offset: at,
          match: "exact",
        });
        from = at + query.length;
      }
    });
    if (queryHasExact) continue;

    const tokens = tokenize(query);
    if (tokens.length < 2) continue;
    const required = tokens.length >= 4 ? Math.ceil(tokens.length / 2) : tokens.length;

    let candidateIndices: number[] | undefined;
    if (options?.ftsCandidates) {
      try {
        const found = options.ftsCandidates(query);
        if (found.length > 0) candidateIndices = found;
      } catch {
        // MATCH failed — fall through to token-AND on all chapters.
      }
    }

    const scan = candidateIndices ?? chapters.map((_, index) => index);
    for (const chapterIndex of scan) {
      const chapter = chapters[chapterIndex];
      if (!chapter) continue;
      const present = tokens.filter((token) => chapter.text.includes(token));
      if (present.length < required) continue;
      const at = chapter.text.indexOf(present[0]);
      if (at === -1) continue;
      push(partial, {
        chapterIndex,
        chapterTitle: chapter.title,
        snippet: snippetAround(chapter.text, at, present[0].length),
        offset: at,
        match: "partial",
      });
    }
  }

  return [...exact, ...partial].slice(0, limit);
}
