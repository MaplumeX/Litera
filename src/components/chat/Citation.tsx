import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BookOpen, TriangleAlert } from "lucide-react";
import type { QuoteLocation } from "@/agent/book/book-content";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface CitationActions {
  /** Check a quote against the open Book. Absent when no Book is available. */
  locate?: (chapterIndex: number, quote: string) => Promise<QuoteLocation>;
  /** Reveal the quote in the Book pane. */
  openInBook?: (location: QuoteLocation, quote: string) => void;
}

export const CitationContext = createContext<CitationActions>({});
/** False while the enclosing text is still streaming: partial quotes are not checked. */
export const CitationSettledContext = createContext(true);

function Passage({ location }: { location: QuoteLocation }) {
  const { passage = "", matchStart, matchEnd } = location;
  if (matchStart == null || matchEnd == null) return <>{passage}</>;
  return (
    <>
      {passage.slice(0, matchStart)}
      <mark className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/30">
        {passage.slice(matchStart, matchEnd)}
      </mark>
      {passage.slice(matchEnd)}
    </>
  );
}

/**
 * An inline Citation: the quote itself is the trigger. After the answer has
 * settled it is checked against the Book; clicking opens the source passage.
 */
export function Citation({
  chapterIndex,
  quote,
  children,
}: {
  chapterIndex: number;
  quote: string;
  children: ReactNode;
}) {
  const { t } = useT();
  const { locate, openInBook } = useContext(CitationContext);
  const settled = useContext(CitationSettledContext);
  const [location, setLocation] = useState<QuoteLocation | null>(null);

  useEffect(() => {
    if (!settled || !locate) return;
    let cancelled = false;
    locate(chapterIndex, quote).then(
      (result) => {
        if (!cancelled) setLocation(result);
      },
      () => {
        // Book switched or the worker failed: leave the citation unchecked.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [chapterIndex, locate, quote, settled]);

  const unverified = location?.status === "unverified";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-citation={location?.status ?? "pending"}
          className={cn(
            "inline cursor-pointer text-left underline decoration-1 underline-offset-[3px]",
            unverified
              ? "text-muted-foreground decoration-dashed decoration-muted-foreground/60"
              : "text-inherit decoration-dotted decoration-primary/60 hover:decoration-primary",
          )}
        >
          {children}
          {unverified && (
            <TriangleAlert
              className="ml-0.5 inline h-3 w-3 -translate-y-px text-amber-600"
              role="img"
              aria-label={t("chat.citation.unverified")}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 text-xs" align="start">
        {!location ? (
          <p className="text-muted-foreground">{t("chat.citation.checking")}</p>
        ) : unverified ? (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
            {t("chat.citation.unverifiedDetail")}
          </p>
        ) : (
          <>
            <div className="font-medium text-foreground">
              {location.chapterTitle ?? t("chat.sources.chapterFallback", { number: location.chapterIndex + 1 })}
            </div>
            {location.status === "relocated" && (
              <p className="text-muted-foreground">{t("chat.citation.relocated")}</p>
            )}
            <p className="max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed text-muted-foreground">
              <Passage location={location} />
            </p>
            {openInBook && (
              <Button size="sm" variant="outline" onClick={() => openInBook(location, quote)}>
                <BookOpen />
                {t("chat.citation.openInBook")}
              </Button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
