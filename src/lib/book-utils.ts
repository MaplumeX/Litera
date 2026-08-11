import { makeBook } from "../foliate-js/view.js";

/**
 * Metadata extracted from an EPUB via foliate.js.
 */
export interface ExtractedMetadata {
  title: string;
  author: string;
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
function extractFirstValue(raw: unknown): string | null {
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

/**
 * Open an EPUB file offscreen using foliate.js, extract metadata + cover,
 * then close the book. Does not mount anything to the DOM.
 */
export async function extractEpubMetadata(
  bytes: number[],
  name: string,
): Promise<ExtractedMetadata> {
  const file = new File([new Uint8Array(bytes)], name);
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

  // Clean up the book resources if possible.
  book.destroy?.();

  return { title, author, coverBytes };
}