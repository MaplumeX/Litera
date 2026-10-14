import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendSearchEvent,
  BOOK_SEARCH_HIT_LIMIT,
  EMPTY_SEARCH_RESULTS,
  stepHit,
  type BookSearchHit,
  type BookSearchResults,
} from "@/lib/book-search";

/** Typing pauses this long before the whole book is scanned again. */
export const BOOK_SEARCH_DEBOUNCE_MS = 400;

export type BookSearchStatus = "idle" | "searching" | "done";

interface UseBookSearchOptions {
  /** Start a whole-book search; null when no Book is open. */
  search: (query: string) => AsyncIterator<unknown> | null;
  /** Remove the match outlines from the Book. */
  clear: () => void;
  /** Navigate to a hit. */
  goTo: (hit: BookSearchHit) => void;
  /** Changes when another Book opens; the old results are dropped. */
  resetKey: string | null;
}

/**
 * Find-in-book state: debounced whole-book scans (a newer query cancels the
 * running one), results grouped by chapter, and the hit the reader is on.
 */
export function useBookSearch({ search, clear, goTo, resetKey }: UseBookSearchOptions) {
  const [query, setQueryState] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<BookSearchResults>(EMPTY_SEARCH_RESULTS);
  const [status, setStatus] = useState<BookSearchStatus>("idle");
  const [activeCfi, setActiveCfi] = useState<string | null>(null);
  const runRef = useRef(0);
  const iteratorRef = useRef<AsyncIterator<unknown> | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;
  const clearRef = useRef(clear);
  clearRef.current = clear;
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRunning = useCallback(() => {
    runRef.current += 1;
    const iterator = iteratorRef.current;
    iteratorRef.current = null;
    void iterator?.return?.()?.catch?.(() => {});
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const run = useCallback(
    async (raw: string) => {
      cancelRunning();
      const text = raw.trim();
      setSubmitted(text);
      setActiveCfi(null);
      setResults(EMPTY_SEARCH_RESULTS);
      if (!text) {
        setStatus("idle");
        clearRef.current();
        return;
      }
      const iterator = searchRef.current(text);
      if (!iterator) {
        setStatus("idle");
        return;
      }
      const run = runRef.current;
      iteratorRef.current = iterator;
      setStatus("searching");
      let acc = EMPTY_SEARCH_RESULTS;
      try {
        while (true) {
          const next = await iterator.next();
          if (run !== runRef.current) return;
          if (next.done) break;
          acc = appendSearchEvent(acc, next.value, BOOK_SEARCH_HIT_LIMIT);
          setResults(acc);
          if (acc.truncated) {
            void iterator.return?.()?.catch?.(() => {});
            break;
          }
        }
      } catch (error) {
        if (run !== runRef.current) return;
        console.error("Book search failed:", error);
      }
      if (run !== runRef.current) return;
      iteratorRef.current = null;
      setResults({ ...acc, progress: 1 });
      setStatus("done");
    },
    [cancelRunning],
  );

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void run(next);
      }, BOOK_SEARCH_DEBOUNCE_MS);
    },
    [run],
  );

  const select = useCallback((hit: BookSearchHit) => {
    setActiveCfi(hit.cfi);
    goToRef.current(hit);
  }, []);

  /** Enter in the field: search now if the text changed, else move to the next / previous hit. */
  const submit = useCallback(
    (step: 1 | -1 = 1) => {
      if (query.trim() !== submitted || status === "idle") {
        void run(query);
        return;
      }
      const hit = stepHit(results.groups, activeCfi, step);
      if (hit) select(hit);
    },
    [activeCfi, query, results.groups, run, select, status, submitted],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      const hit = stepHit(results.groups, activeCfi, direction);
      if (hit) select(hit);
    },
    [activeCfi, results.groups, select],
  );

  const reset = useCallback(() => {
    cancelRunning();
    setQueryState("");
    setSubmitted("");
    setResults(EMPTY_SEARCH_RESULTS);
    setStatus("idle");
    setActiveCfi(null);
    clearRef.current();
  }, [cancelRunning]);

  // Another Book: drop the old query and results. (The reader clears its
  // own outlines when it closes the previous Book.)
  useEffect(() => {
    cancelRunning();
    setQueryState("");
    setSubmitted("");
    setResults(EMPTY_SEARCH_RESULTS);
    setStatus("idle");
    setActiveCfi(null);
  }, [cancelRunning, resetKey]);

  useEffect(() => cancelRunning, [cancelRunning]);

  return { query, setQuery, submit, step, select, reset, results, status, activeCfi, submitted };
}
