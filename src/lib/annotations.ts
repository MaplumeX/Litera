import type {
  AnnotationsFile,
  BookmarkRecord,
  HighlightRecord,
} from "@/types/library";

export const ANNOTATIONS_SCHEMA_VERSION = 1;
export const MAX_EXCERPT_BYTES = 4 * 1024;

export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function emptyAnnotations(): AnnotationsFile {
  return {
    schemaVersion: ANNOTATIONS_SCHEMA_VERSION,
    bookmarks: [],
    highlights: [],
  };
}

export function createBookmark(location: {
  cfi: string;
  fraction: number;
  label?: string;
}): BookmarkRecord {
  return {
    id: crypto.randomUUID(),
    cfi: location.cfi,
    fraction: location.fraction,
    createdAt: new Date().toISOString(),
    ...(location.label ? { label: location.label } : {}),
  };
}

export function createHighlight(selection: {
  cfi: string;
  excerpt: string;
}): HighlightRecord {
  return {
    id: crypto.randomUUID(),
    cfi: selection.cfi,
    excerpt: truncateUtf8Bytes(selection.excerpt, MAX_EXCERPT_BYTES),
    createdAt: new Date().toISOString(),
  };
}

export function appendBookmark(
  data: AnnotationsFile,
  bookmark: BookmarkRecord,
): AnnotationsFile {
  if (data.bookmarks.some((item) => item.cfi === bookmark.cfi)) return data;
  return { ...data, bookmarks: [...data.bookmarks, bookmark] };
}

export function appendHighlight(
  data: AnnotationsFile,
  highlight: HighlightRecord,
): AnnotationsFile {
  if (data.highlights.some((item) => item.cfi === highlight.cfi)) return data;
  return { ...data, highlights: [...data.highlights, highlight] };
}

export function removeBookmark(
  data: AnnotationsFile,
  id: string,
): AnnotationsFile {
  return {
    ...data,
    bookmarks: data.bookmarks.filter((item) => item.id !== id),
  };
}

export function removeHighlight(
  data: AnnotationsFile,
  id: string,
): { next: AnnotationsFile; removed?: HighlightRecord } {
  const removed = data.highlights.find((item) => item.id === id);
  return {
    next: {
      ...data,
      highlights: data.highlights.filter((item) => item.id !== id),
    },
    removed,
  };
}
