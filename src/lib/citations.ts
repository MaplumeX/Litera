/**
 * Citation helpers. The assistant marks a verbatim quote from the Book as a
 * Markdown link `[quote](cite:CHAPTER_INDEX)`; see CONTEXT.md "Citation".
 */

const CITE_SCHEME = "cite:";
const CITATION_LINK = /\[([^\]\n]*)\]\(cite:[^)\s]*\)/g;
const QUOTE_ELLIPSIS = /…+|\.{3,}|。{3,}/;
const QUOTE_MARKS = /^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g;
const FALLBACK_QUERY_CHARS = 20;

export function isCitationHref(href: string | undefined): href is string {
  return typeof href === "string" && href.startsWith(CITE_SCHEME);
}

/** The cited chapterIndex, or -1 when the marker is malformed. */
export function citationChapterIndex(href: string): number {
  const raw = href.slice(CITE_SCHEME.length).trim();
  if (!/^\d+$/.test(raw)) return -1;
  const index = Number(raw);
  return Number.isSafeInteger(index) ? index : -1;
}

/** Plain text for copying: citation links collapse to their quote. */
export function stripCitations(text: string): string {
  return text.replace(CITATION_LINK, "$1");
}

/**
 * Text searches for locating a quote in the rendered Book: the longest
 * ellipsis-free segment, then its first few characters as a looser retry.
 */
export function quoteSearchQueries(quote: string): string[] {
  const segments = quote
    .trim()
    .replace(QUOTE_MARKS, "")
    .split(QUOTE_ELLIPSIS)
    .map((segment) => segment.replace(QUOTE_MARKS, "").trim())
    .filter(Boolean);
  if (segments.length === 0) return [];
  const longest = segments.reduce((best, segment) => (segment.length > best.length ? segment : best));
  const head = longest.slice(0, FALLBACK_QUERY_CHARS);
  return head.length < longest.length ? [longest, head] : [longest];
}
