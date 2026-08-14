import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import {
  CHAPTER_PART_CHARS,
  hrefMatches,
  type BookMetadata,
  type BookTocEntry,
  type SearchHit,
} from "./book-content";

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string;
}

interface TocItem {
  label: string;
  href: string;
}

interface Chapter {
  label: string;
  hrefs: string[];
  text: string;
}

export interface ParsedBook {
  metadata: BookMetadata;
  chapters: Chapter[];
  trigramIndex: Map<string, number[]>;
}

const parseXml = (source: string, mime = "application/xml") =>
  new DOMParser().parseFromString(source, mime);

function directory(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}

export function resolveHref(baseFile: string, relative: string): string {
  const parts = `${directory(baseFile)}${relative.split("#")[0]}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function fileText(files: Record<string, Uint8Array>, path: string): string {
  const bytes = files[path] ?? files[path.replace(/^\//, "")];
  return bytes ? strFromU8(bytes) : "";
}

function firstText(root: ReturnType<typeof parseXml>, names: string[], fallback: string): string {
  for (const name of names) {
    const value = root.getElementsByTagName(name)[0]?.textContent?.trim();
    if (value) return value;
  }
  return fallback;
}

function htmlText(source: string): string {
  return parseXml(source, "text/html")
    .documentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function parseNav(files: Record<string, Uint8Array>, nav: ManifestItem): TocItem[] {
  const root = parseXml(fileText(files, nav.href), "text/html");
  const navs = Array.from(root.getElementsByTagName("nav"));
  const tocNav = navs.find((node) => {
    const kind = node.getAttribute("epub:type") ?? node.getAttribute("type") ?? "";
    return kind.split(/\s+/).includes("toc") || node.getAttribute("role") === "doc-toc";
  }) ?? navs[0];
  if (!tocNav) return [];
  return Array.from(tocNav.getElementsByTagName("a")).flatMap((anchor) => {
    const href = anchor.getAttribute("href");
    const label = anchor.textContent?.replace(/\s+/g, " ").trim();
    return href && label ? [{ label, href: resolveHref(nav.href, href) }] : [];
  });
}

function parseNcx(files: Record<string, Uint8Array>, ncx: ManifestItem): TocItem[] {
  const root = parseXml(fileText(files, ncx.href));
  return Array.from(root.getElementsByTagName("navPoint")).flatMap((point) => {
    const label = point.getElementsByTagName("text")[0]?.textContent?.trim();
    const href = point.getElementsByTagName("content")[0]?.getAttribute("src");
    return label && href ? [{ label, href: resolveHref(ncx.href, href) }] : [];
  });
}

export function buildOwnedChapters(
  toc: readonly TocItem[],
  spineHrefs: readonly string[],
  spineTexts: readonly string[],
): Chapter[] {
  const owners: Array<number | undefined> = spineHrefs.map(() => undefined);
  toc.forEach((item, tocIndex) => {
    const spineIndex = spineHrefs.findIndex(
      (href, index) => owners[index] === undefined && hrefMatches(item.href, href),
    );
    if (spineIndex >= 0) owners[spineIndex] = tocIndex;
  });
  let previous: number | undefined;
  owners.forEach((owner, index) => {
    if (owner !== undefined) previous = owner;
    else if (previous !== undefined) owners[index] = previous;
  });

  if (!toc.length || owners.every((owner) => owner === undefined)) {
    return spineHrefs.flatMap((href, index) => {
      const text = spineTexts[index] ?? "";
      return text ? [{ label: "", hrefs: [href], text }] : [];
    });
  }

  const buckets = toc.map((item) => ({ label: item.label, hrefs: [item.href], texts: [] as string[] }));
  spineHrefs.forEach((href, index) => {
    const owner = owners[index];
    if (owner === undefined) return;
    const bucket = buckets[owner];
    if (!bucket.hrefs.some((candidate) => hrefMatches(candidate, href))) bucket.hrefs.push(href);
    if (spineTexts[index]) bucket.texts.push(spineTexts[index]);
  });
  return buckets.flatMap((bucket) => {
    const text = bucket.texts.join("");
    return text ? [{ label: bucket.label, hrefs: bucket.hrefs, text }] : [];
  });
}

export function parseEpub(buffer: ArrayBuffer): ParsedBook {
  const files = unzipSync(new Uint8Array(buffer));
  const container = parseXml(fileText(files, "META-INF/container.xml"));
  const opfPath = container.getElementsByTagName("rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB package document is missing");
  const opf = parseXml(fileText(files, opfPath));
  const manifest = new Map<string, ManifestItem>();
  for (const node of Array.from(opf.getElementsByTagName("item"))) {
    const id = node.getAttribute("id");
    const href = node.getAttribute("href");
    if (!id || !href) continue;
    manifest.set(id, {
      href: resolveHref(opfPath, href),
      mediaType: node.getAttribute("media-type") ?? "",
      properties: node.getAttribute("properties") ?? "",
    });
  }
  const spineHrefs = Array.from(opf.getElementsByTagName("itemref")).flatMap((node) => {
    const item = manifest.get(node.getAttribute("idref") ?? "");
    return item ? [item.href] : [];
  });
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  const ncx = [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml");
  const toc = nav ? parseNav(files, nav) : ncx ? parseNcx(files, ncx) : [];
  const chapters = buildOwnedChapters(
    toc,
    spineHrefs,
    spineHrefs.map((href) => htmlText(fileText(files, href))),
  );
  return {
    metadata: {
      title: firstText(opf, ["dc:title", "title"], "Unknown"),
      author: firstText(opf, ["dc:creator", "creator"], "Unknown"),
      language: firstText(opf, ["dc:language", "language"], "en"),
      totalChapters: chapters.length,
    },
    chapters,
    trigramIndex: buildTrigramIndex(chapters),
  };
}

function buildTrigramIndex(chapters: readonly Chapter[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  chapters.forEach((chapter, chapterIndex) => {
    const seen = new Set<string>();
    for (let offset = 0; offset + 3 <= chapter.text.length; offset += 1) {
      seen.add(chapter.text.slice(offset, offset + 3));
    }
    for (const trigram of seen) {
      const candidates = index.get(trigram);
      if (candidates) candidates.push(chapterIndex);
      else index.set(trigram, [chapterIndex]);
    }
  });
  return index;
}

export function bookToc(book: ParsedBook): BookTocEntry[] {
  return book.chapters.map((chapter, index) => ({
    index,
    label: chapter.label,
    hrefs: chapter.hrefs,
    chars: chapter.text.length,
  }));
}

export function readChapter(book: ParsedBook, chapterIndex: number, rawPart = 0) {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) throw new Error("Chapter index is out of range");
  const totalParts = Math.max(1, Math.ceil(chapter.text.length / CHAPTER_PART_CHARS));
  const part = Math.min(Math.max(0, Math.trunc(rawPart) || 0), totalParts - 1);
  return {
    chapterIndex,
    chapterNumber: chapterIndex + 1,
    part,
    totalParts,
    text: chapter.text.slice(part * CHAPTER_PART_CHARS, (part + 1) * CHAPTER_PART_CHARS),
  };
}

export function searchBook(book: ParsedBook, queries: string[]): SearchHit[] {
  const clean = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 12);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const query of clean) {
    let exact = false;
    book.chapters.forEach((chapter, chapterIndex) => {
      let from = 0;
      for (let count = 0; count < 3; count += 1) {
        const offset = chapter.text.indexOf(query, from);
        if (offset < 0) break;
        exact = true;
        pushHit(hits, seen, chapter, chapterIndex, offset, query.length, "exact");
        from = offset + query.length;
      }
    });
    if (exact) continue;
    const tokens = query.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
    if (tokens.length < 2) continue;
    const required = tokens.length >= 4 ? Math.ceil(tokens.length / 2) : tokens.length;
    const longTokens = tokens.filter((token) => token.length >= 3);
    const shortTokenCount = tokens.length - longTokens.length;
    const candidateIndices = longTokens.length > 0 && shortTokenCount < required
      ? [...new Set(longTokens.flatMap((token) => book.trigramIndex.get(token.slice(0, 3)) ?? []))]
      : book.chapters.map((_, index) => index);
    candidateIndices.forEach((chapterIndex) => {
      const chapter = book.chapters[chapterIndex];
      const present = tokens.filter((token) => chapter.text.includes(token));
      if (present.length < required) return;
      const offset = chapter.text.indexOf(present[0]);
      pushHit(hits, seen, chapter, chapterIndex, offset, present[0].length, "partial");
    });
  }
  return hits.slice(0, 16);
}

function pushHit(
  hits: SearchHit[],
  seen: Set<string>,
  chapter: Chapter,
  chapterIndex: number,
  offset: number,
  matchLength: number,
  match: SearchHit["match"],
) {
  const key = `${chapterIndex}:${Math.floor(offset / 200)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const start = Math.max(0, offset - 160);
  const end = offset + matchLength + 160;
  hits.push({
    chapterIndex,
    chapterTitle: chapter.label || undefined,
    part: Math.floor(offset / CHAPTER_PART_CHARS),
    match,
    snippet: `${start ? "…" : ""}${chapter.text.slice(start, end)}${end < chapter.text.length ? "…" : ""}`,
  });
}
