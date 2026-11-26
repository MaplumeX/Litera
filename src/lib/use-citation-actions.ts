import { useMemo } from "react";
import type { QuoteLocation } from "@/agent/book/book-content";
import type { GuideBlockTarget } from "@/lib/guide-marks";
import type { CitationActions } from "@/components/chat/Citation";

/**
 * Shared Citation verification cache & Book-jump actions for both
 * `ChatWorkspace` and `GuideWorkspace`. Verification results are cached per
 * open Book so re-renders and repeated quotes never hit the EPUB worker twice.
 */
export function useCitationActions(
  bookId: string,
  locateQuote?: (chapterIndex: number, quote: string) => Promise<QuoteLocation>,
  onOpenQuote?: (location: QuoteLocation, quote: string, block?: GuideBlockTarget) => void,
): CitationActions {
  return useMemo<CitationActions>(() => {
    if (!locateQuote) return { openInBook: onOpenQuote };
    const cache = new Map<string, Promise<QuoteLocation>>();
    return {
      locate: (chapterIndex, quote) => {
        const key = `${bookId}\u0000${chapterIndex}\u0000${quote}`;
        let pending = cache.get(key);
        if (!pending) {
          pending = locateQuote(chapterIndex, quote);
          cache.set(key, pending);
          pending.catch(() => cache.delete(key));
        }
        return pending;
      },
      openInBook: onOpenQuote,
    };
  }, [bookId, locateQuote, onOpenQuote]);
}
