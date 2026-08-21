import type {
  AnnotationsFile,
  BookmarkRecord,
  HighlightColor,
  HighlightRecord,
} from "@/types/library";

export const ANNOTATIONS_SCHEMA_VERSION = 1;
export const MAX_EXCERPT_BYTES = 4 * 1024;
export const MAX_NOTE_BYTES = 4 * 1024;
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
];

export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#fbbf24",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  orange: "#fb923c",
};

let lastUsedHighlightColor: HighlightColor | null = null;

export function isHighlightColor(value: unknown): value is HighlightColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightColor);
}

export function resolveHighlightColor(color?: string): HighlightColor {
  return isHighlightColor(color) ? color : DEFAULT_HIGHLIGHT_COLOR;
}

export function highlightColorHex(color?: string): string {
  return HIGHLIGHT_COLOR_HEX[resolveHighlightColor(color)];
}

export function getLastUsedHighlightColor(): HighlightColor {
  return lastUsedHighlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
}

export function setLastUsedHighlightColor(color: HighlightColor): void {
  lastUsedHighlightColor = color;
}

export function resetLastUsedHighlightColor(): void {
  lastUsedHighlightColor = null;
}

/** Overlay keys for user highlights are CFI strings; TTS / search use other prefixes. */
export function isHighlightOverlayKey(value: string | undefined): boolean {
  return Boolean(value?.startsWith("epubcfi("));
}

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
    color: getLastUsedHighlightColor(),
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

export function updateHighlight(
  data: AnnotationsFile,
  id: string,
  patch: { color?: HighlightColor; note?: string | null },
): AnnotationsFile {
  const index = data.highlights.findIndex((item) => item.id === id);
  if (index < 0) return data;
  const current = data.highlights[index];
  if (patch.color) setLastUsedHighlightColor(patch.color);

  const color = patch.color ?? current.color ?? DEFAULT_HIGHLIGHT_COLOR;
  let note: string | undefined;
  if (patch.note !== undefined) {
    const trimmed = patch.note?.trim() ?? "";
    note = trimmed ? truncateUtf8Bytes(trimmed, MAX_NOTE_BYTES) : undefined;
  } else {
    note = current.note;
  }

  const nextItem: HighlightRecord = {
    id: current.id,
    cfi: current.cfi,
    excerpt: current.excerpt,
    createdAt: current.createdAt,
    color,
    ...(note ? { note } : {}),
  };
  if (
    nextItem.color === current.color &&
    nextItem.note === current.note
  ) {
    return data;
  }
  const highlights = data.highlights.slice();
  highlights[index] = nextItem;
  return { ...data, highlights };
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
