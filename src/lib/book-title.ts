/** Where a subtitle or edition note starts in a stored book title. */
const SUBTITLE_START = /[【［\[（(：:｜|]/;

/**
 * The part of a book title worth a titlebar: everything before a bracketed
 * note or subtitle, e.g. "置身事内【复旦经院“毕业课”…】" → "置身事内". A
 * title that starts with such a mark, or would shrink to a single character,
 * is kept whole.
 */
export function shortBookTitle(title: string): string {
  const trimmed = title.trim();
  const cut = trimmed.search(SUBTITLE_START);
  if (cut <= 0) return trimmed;
  const head = trimmed.slice(0, cut).trim();
  return head.length >= 2 ? head : trimmed;
}
