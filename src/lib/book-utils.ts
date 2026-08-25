import { makeBook } from "../foliate-js/view.js";

/** Matches Rust `MAX_AUTHOR_BYTES` for publisher / language / series. */
export const MAX_AUTHOR_BYTES = 4 * 1024;
/** Matches Rust `MAX_DESCRIPTION_BYTES`. */
export const MAX_DESCRIPTION_BYTES = 32 * 1024;

/**
 * Metadata extracted from an EPUB via foliate.js.
 */
export interface ExtractedMetadata {
  title: string;
  author: string;
  description: string;
  publisher: string;
  language: string;
  series: string;
  /** Cover image bytes (PNG), or null if no cover. */
  coverBytes: number[] | null;
}

/** Try to extract the first value from a foliate language-map-like field.
 * foliate metadata fields can be:
 *  - a plain string
 *  - a language map: { en: "Title", zh: "书名" } (Record<string, string>)
 *  - an array of { lang?, value } objects
 *  - a single { value } object
 */
export function extractFirstValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  // Language map: { en: "Title", zh: "书名" } — pick the first value.
  if (
    typeof raw === "object"
    && !Array.isArray(raw)
    && !("value" in raw)
  ) {
    const values = Object.values(raw as Record<string, unknown>);
    for (const v of values) {
      if (typeof v === "string") return v;
    }
    return null;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0] as unknown;
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "value" in first) {
      return String((first as { value: unknown }).value);
    }
  }
  if (typeof raw === "object" && "value" in raw) {
    return String((raw as { value: unknown }).value);
  }
  return null;
}

/** Strip tags and collapse whitespace. EPUB descriptions are sometimes HTML. */
export function stripHtmlToPlainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Join dc:language string or BCP-47 array. */
export function extractLanguage(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  }
  return extractFirstValue(raw)?.trim() ?? "";
}

/** Series name, plus ` · {position}` when position is a finite number. */
export function extractSeries(belongsTo: unknown): string {
  if (!belongsTo || typeof belongsTo !== "object") return "";
  const series = (belongsTo as { series?: unknown }).series;
  if (series == null) return "";
  const item = Array.isArray(series) ? series[0] : series;
  if (item == null) return "";
  const nameRaw =
    typeof item === "object" && item !== null && "name" in item
      ? (item as { name: unknown }).name
      : item;
  const name = extractFirstValue(nameRaw)?.trim() ?? "";
  if (!name) return "";
  const position =
    typeof item === "object" && item !== null && "position" in item
      ? (item as { position: unknown }).position
      : undefined;
  if (typeof position === "number" && Number.isFinite(position)) {
    return `${name} · ${position}`;
  }
  return name;
}

/** Truncate to a UTF-8 byte cap without splitting a code point. */
export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const encoded = new TextEncoder().encode(value);
  if (encoded.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return new TextDecoder().decode(encoded.slice(0, end));
}

function safeShelfText(extract: () => string, maxBytes: number): string {
  try {
    return truncateUtf8Bytes(extract(), maxBytes);
  } catch {
    return "";
  }
}

/**
 * Open an EPUB file offscreen using foliate.js, extract metadata + cover,
 * then close the book. Does not mount anything to the DOM.
 */
export async function extractEpubMetadata(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): Promise<ExtractedMetadata> {
  const file = new File([bytes], name);
  const book = await makeBook(file);

  // Extract title — foliate metadata.title can be a string or a language map.
  const rawTitle = book.metadata?.title as unknown;
  const title =
    typeof rawTitle === "string" ? rawTitle : extractFirstValue(rawTitle) ?? name;

  // Extract author — metadata.author is an array of contributor objects { name, ... }.
  // Use extractFirstValue to handle language-map author names too.
  const rawAuthor = book.metadata?.author;
  let author = "";
  if (Array.isArray(rawAuthor)) {
    author = rawAuthor
      .map((a: unknown) => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object" && "name" in a) {
          const name = (a as { name: unknown }).name;
          return extractFirstValue(name) ?? (typeof name === "string" ? name : "");
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  } else if (typeof rawAuthor === "string") {
    author = rawAuthor;
  } else if (rawAuthor != null) {
    author = extractFirstValue(rawAuthor) ?? "";
  }

  // Extract cover Blob → bytes.
  let coverBytes: number[] | null = null;
  try {
    const coverBlob = await book.getCover?.();
    if (coverBlob) {
      const arrayBuffer = await coverBlob.arrayBuffer();
      coverBytes = Array.from(new Uint8Array(arrayBuffer));
    }
  } catch {
    // No cover available — that's fine.
  }

  const metadata = book.metadata;
  const description = safeShelfText(
    () => stripHtmlToPlainText(extractFirstValue(metadata?.description) ?? ""),
    MAX_DESCRIPTION_BYTES,
  );
  const publisher = safeShelfText(
    () => extractFirstValue(metadata?.publisher)?.trim() ?? "",
    MAX_AUTHOR_BYTES,
  );
  const language = safeShelfText(
    () => extractLanguage(metadata?.language),
    MAX_AUTHOR_BYTES,
  );
  const series = safeShelfText(
    () => extractSeries(metadata?.belongsTo),
    MAX_AUTHOR_BYTES,
  );

  // Clean up the book resources if possible.
  book.destroy?.();

  return { title, author, description, publisher, language, series, coverBytes };
}
