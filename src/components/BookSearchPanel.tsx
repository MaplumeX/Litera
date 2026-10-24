import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BookSearchHit, BookSearchResults } from "@/lib/book-search";
import { useT } from "@/lib/i18n";
import type { BookSearchStatus } from "@/lib/use-book-search";
import { cn } from "@/lib/utils";

interface BookSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Enter: search, or step to the next (Shift: previous) hit of the same query. */
  onSubmit: (step: 1 | -1) => void;
  onStep: (step: 1 | -1) => void;
  onSelect: (hit: BookSearchHit) => void;
  onClear: () => void;
  results: BookSearchResults;
  status: BookSearchStatus;
  activeCfi: string | null;
  /** Bumped by Ctrl/⌘+F: focus and select the field again. */
  focusToken: number;
  /** False when the field lives elsewhere (the phone's app bar). */
  showField?: boolean;
}

/** Find in the Book: a field, a running count, and matches grouped by chapter. */
export function BookSearchPanel({
  query,
  onQueryChange,
  onSubmit,
  onStep,
  onSelect,
  onClear,
  results,
  status,
  activeCfi,
  focusToken,
  showField = true,
}: BookSearchPanelProps) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusToken]);

  // Keep the hit stepped to with Enter / the arrows in view.
  useEffect(() => {
    if (!activeCfi) return;
    const row = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [activeCfi]);

  const activeIndex = activeCfi
    ? results.groups.flatMap((group) => group.hits).findIndex((hit) => hit.cfi === activeCfi)
    : -1;
  const searching = status === "searching";
  const summary =
    status === "idle"
      ? null
      : results.total === 0
        ? searching
          ? t("search.searching", { pct: Math.round(results.progress * 100) })
          : t("search.noResults")
        : activeIndex >= 0
          ? t("search.position", { index: activeIndex + 1, total: results.total })
          : t("search.count", { total: results.total });

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="px-3 pb-2">
        {showField && (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              type="search"
              value={query}
              placeholder={t("search.placeholder")}
              aria-label={t("search.label")}
              className="h-8 pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmit(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape" && query) {
                  // First Esc clears the field; the next one closes the panel.
                  event.preventDefault();
                  event.stopPropagation();
                  onClear();
                }
              }}
            />
            {query && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                aria-label={t("search.clear")}
                onClick={() => {
                  onClear();
                  inputRef.current?.focus();
                }}
              >
                <X />
              </Button>
            )}
          </div>
        )}
        {summary && (
          <div className={cn("flex h-6 items-center gap-1", showField && "mt-2")}>
            <span
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {summary}
            </span>
            {results.total > 0 && (
              <>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("search.previous")}
                  onClick={() => onStep(-1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("search.next")}
                  onClick={() => onStep(1)}
                >
                  <ChevronDown />
                </Button>
              </>
            )}
          </div>
        )}
        {searching && (
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
            <div
              className="h-full bg-primary/60 transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${Math.round(results.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3">
        {results.groups.map((group, groupIndex) => (
          <section key={`${group.label}-${groupIndex}`}>
            <h2 className="truncate px-4 pb-1 text-xs font-medium text-muted-foreground">
              {group.label || t("search.untitledChapter")}
            </h2>
            {group.hits.map((hit) => {
              const active = hit.cfi === activeCfi;
              return (
                <div key={hit.cfi} className="px-1">
                  <button
                    type="button"
                    aria-current={active || undefined}
                    className={cn(
                      "w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors duration-150 motion-reduce:transition-none",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
                    )}
                    onClick={() => onSelect(hit)}
                  >
                    <span className="line-clamp-3">
                      {hit.pre}
                      <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
                        {hit.match}
                      </mark>
                      {hit.post}
                    </span>
                  </button>
                </div>
              );
            })}
          </section>
        ))}
        {results.truncated && (
          <div className="px-4 text-xs text-muted-foreground">
            {t("search.truncated", { total: results.total })}
          </div>
        )}
      </div>
    </div>
  );
}
