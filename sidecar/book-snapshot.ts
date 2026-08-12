import type { BookMetadata, TocEntry } from "./book.js";

export const BOOK_SNAPSHOT_CUSTOM_TYPE = "bookSnapshot";
export const BOOK_SNAPSHOT_MAX_TOC_ENTRIES = 200;
export const BOOK_SNAPSHOT_MAX_TOC_CHARS = 4000;

export function formatBookSnapshot(meta: BookMetadata, toc: readonly TocEntry[]): string {
  const lines: string[] = [];
  let bodyChars = 0;
  for (const entry of toc) {
    if (lines.length >= BOOK_SNAPSHOT_MAX_TOC_ENTRIES) break;
    const line = `${entry.index}: ${entry.label}`;
    const nextChars = bodyChars === 0 ? line.length : bodyChars + 1 + line.length;
    if (nextChars > BOOK_SNAPSHOT_MAX_TOC_CHARS) break;
    lines.push(line);
    bodyChars = nextChars;
  }
  const truncated = lines.length < toc.length;
  const parts = [
    "Book snapshot (already provided; do not call get_book_metadata or get_toc unless the TOC is truncated or you need hrefs):",
    `Title: ${meta.title}`,
    `Author: ${meta.author}`,
    `Language: ${meta.language}`,
    `Total chapters: ${meta.totalChapters}`,
    "",
    `Table of Contents (${lines.length} of ${toc.length} entries):`,
  ];
  if (lines.length > 0) parts.push(lines.join("\n"));
  if (truncated) parts.push("[TOC truncated. Call get_toc for the full list.]");
  return parts.join("\n");
}

export function sessionHasBookSnapshot(messages: readonly unknown[]): boolean {
  return messages.some((message) =>
    !!message
    && typeof message === "object"
    && (message as { role?: unknown }).role === "custom"
    && (message as { customType?: unknown }).customType === BOOK_SNAPSHOT_CUSTOM_TYPE
  );
}
