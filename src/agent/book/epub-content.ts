import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
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

export interface NavNode {
  label: string;
  /** Resolved href; keeps the `#fragment` when the TOC entry carries one. */
  href: string;
  /** TOC nesting depth, 0 = top level. */
  depth: number;
}

export interface Segment {
  /** Anchor id that starts this slice; undefined for the leading slice. */
  anchorId?: string;
  text: string;
}

interface Chapter {
  label: string;
  ancestors: string[];
  depth: number;
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
  const hashIndex = relative.indexOf("#");
  const target = hashIndex >= 0 ? relative.slice(0, hashIndex) : relative;
  const fragment = hashIndex >= 0 ? relative.slice(hashIndex) : "";
  const parts = `${directory(baseFile)}${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/") + fragment;
}

/** Strip a `#fragment`; used where only the file path is meaningful (OPF manifest/spine). */
export function stripFragment(href: string): string {
  return href.split("#")[0];
}

export function hrefFragment(href: string): string {
  const hashIndex = href.indexOf("#");
  return hashIndex >= 0 ? href.slice(hashIndex + 1) : "";
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

function elementTag(node: XmlNode): string {
  return ((node as XmlElement).tagName ?? "").toLowerCase();
}

/** Depth inside the toc nav: the nav's direct `<ol>` holds depth-0 entries. */
function navAnchorDepth(anchor: XmlElement, tocNav: XmlElement): number {
  let depth = 0;
  for (let node: XmlNode | null = anchor.parentNode; node && node !== tocNav; node = node.parentNode) {
    if (elementTag(node) === "ol") depth += 1;
  }
  return Math.max(0, depth - 1);
}

/** Depth inside the NCX navMap: top-level navPoints are depth 0. */
function navPointDepth(point: XmlElement): number {
  let depth = 0;
  for (let node: XmlNode | null = point.parentNode; node; node = node.parentNode) {
    if (elementTag(node) === "navpoint") depth += 1;
  }
  return depth;
}

function parseNav(files: Record<string, Uint8Array>, nav: ManifestItem): NavNode[] {
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
    return href && label
      ? [{ label, href: resolveHref(nav.href, href), depth: navAnchorDepth(anchor, tocNav) }]
      : [];
  });
}

function parseNcx(files: Record<string, Uint8Array>, ncx: ManifestItem): NavNode[] {
  const root = parseXml(fileText(files, ncx.href));
  return Array.from(root.getElementsByTagName("navPoint")).flatMap((point) => {
    const label = point.getElementsByTagName("text")[0]?.textContent?.trim();
    const href = point.getElementsByTagName("content")[0]?.getAttribute("src");
    return label && href
      ? [{ label, href: resolveHref(ncx.href, href), depth: navPointDepth(point) }]
      : [];
  });
}

function anchorIdOf(element: XmlElement): string | undefined {
  const id = element.getAttribute("id");
  if (id) return id;
  if (elementTag(element) === "a") {
    const name = element.getAttribute("name");
    if (name) return name;
  }
  return undefined;
}

/**
 * Split one spine document into anchor-bounded segments: each element carrying
 * a non-empty `id` (or an EPUB2 `<a name>`) starts a new segment that runs to
 * the next anchor element (or end of file). Without anchors the whole file is a
 * single leading segment — identical to the legacy `htmlText` projection.
 */
export function parseSpineSegments(source: string): Segment[] {
  try {
    const parsed = parseXml(source, "text/html");
    const root = parsed.documentElement;
    if (!root) return [{ text: htmlText(source) }];
    const segments: Segment[] = [];
    let parts: string[] = [];
    let anchorId: string | undefined = undefined;
    const finish = () => {
      segments.push({ anchorId, text: parts.join("").replace(/\s+/g, " ").trim() });
      parts = [];
    };
    const visit = (node: XmlNode) => {
      const type = node.nodeType;
      if (type === 3 || type === 4) {
        const value = node.nodeValue;
        if (value) parts.push(value);
        return;
      }
      if (type !== 1) return;
      const element = node as XmlElement;
      const nextAnchor = anchorIdOf(element);
      if (nextAnchor !== undefined) {
        finish();
        anchorId = nextAnchor;
      }
      const children = element.childNodes;
      for (let index = 0; index < children.length; index += 1) visit(children[index]);
    };
    visit(root);
    finish();
    return segments.length ? segments : [{ text: "" }];
  } catch {
    return [{ text: htmlText(source) }];
  }
}

function sameTarget(left: string, right: string): boolean {
  return hrefMatches(left, right) && hrefFragment(left) === hrefFragment(right);
}

function segmentText(segments: readonly Segment[]): string {
  return segments.map((segment) => segment.text).filter(Boolean).join("");
}

function addFileToBucket(bucket: { hrefs: string[]; texts: string[] }, href: string, text: string): void {
  if (!bucket.hrefs.includes(href)) bucket.hrefs.push(href);
  if (text) bucket.texts.push(text);
}

/**
 * Anchor-aware ownership. For every spine file the non-container TOC nodes
 * targeting it (in TOC order) split the file's segments: a node whose
 * `#fragment` resolves to a segment owns that slice, unclaimed slices join the
 * preceding claimer (the file's first node for leading text), and nodes with
 * missing/unresolvable fragments merge into the preceding claimer's bucket (R5)
 * so no text is ever lost. The union of all chapter texts equals the union of
 * all spine texts.
 */
export function buildOwnedChapters(
  nodes: readonly NavNode[],
  spineHrefs: readonly string[],
  spineSegments: readonly Segment[][],
): Chapter[] {
  interface Info { node: NavNode; ancestors: string[]; container: boolean }
  const stack: Array<{ depth: number; label: string }> = [];
  const infos: Info[] = nodes.map((node, index) => {
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    const ancestors = stack.map((entry) => entry.label);
    stack.push({ depth: node.depth, label: node.label });
    const next = nodes[index + 1];
    const container =
      next !== undefined && next.depth > node.depth && sameTarget(node.href, next.href);
    return { node, ancestors, container };
  });

  interface Bucket { label: string; ancestors: string[]; depth: number; hrefs: string[]; texts: string[] }
  const buckets = new Map<number, Bucket>();
  const bucketFor = (global: number, info: Info): Bucket => {
    let bucket = buckets.get(global);
    if (!bucket) {
      bucket = { label: info.node.label, ancestors: info.ancestors, depth: info.node.depth, hrefs: [], texts: [] };
      buckets.set(global, bucket);
    }
    return bucket;
  };
  let previous: Bucket | undefined;
  const leadingFiles: Array<{ href: string; text: string }> = [];

  spineHrefs.forEach((fileHref, fileIndex) => {
    const targeting: Array<{ global: number; info: Info }> = [];
    infos.forEach((info, global) => {
      if (!info.container && hrefMatches(info.node.href, fileHref)) targeting.push({ global, info });
    });
    const segments = spineSegments[fileIndex] ?? [];
    if (!targeting.length) {
      const text = segmentText(segments);
      if (previous) addFileToBucket(previous, fileHref, text);
      else leadingFiles.push({ href: fileHref, text });
      return;
    }
    // Resolvable fragment claims; the first node claiming a segment wins.
    const claimOf = new Map<number, number>();
    targeting.forEach(({ info }, local) => {
      const fragment = hrefFragment(info.node.href);
      if (!fragment) return;
      const segmentIndex = segments.findIndex((segment) => segment.anchorId === fragment);
      if (segmentIndex >= 0 && !claimOf.has(segmentIndex)) claimOf.set(segmentIndex, local);
    });
    const owners: number[] = new Array(segments.length).fill(0);
    if (claimOf.size) {
      let current = -1;
      for (let index = 0; index < segments.length; index += 1) {
        const claimed = claimOf.get(index);
        if (claimed !== undefined) current = claimed;
        owners[index] = current >= 0 ? current : 0;
      }
    }
    let lastBucket: Bucket | undefined;
    targeting.forEach(({ info }, local) => {
      const owned: number[] = [];
      segments.forEach((_, index) => {
        if (owners[index] === local) owned.push(index);
      });
      // A node with no owned slice (unresolvable fragment) keeps no chapter; its
      // would-be text already lives in the preceding claimer's bucket (R5).
      if (!owned.length) return;
      const bucket = bucketFor(targeting[local].global, info);
      owned.forEach((index) => {
        const segment = segments[index];
        const href = segment.anchorId === undefined ? fileHref : `${fileHref}#${segment.anchorId}`;
        if (!bucket.hrefs.includes(href)) bucket.hrefs.push(href);
        if (segment.text) bucket.texts.push(segment.text);
      });
      lastBucket = bucket;
    });
    if (lastBucket) previous = lastBucket;
  });

  const first = buckets.values().next().value;
  if (first) leadingFiles.forEach(({ href, text }) => addFileToBucket(first, href, text));

  const chapters: Chapter[] = [];
  infos.forEach((info, global) => {
    const bucket = buckets.get(global);
    if (info.container || !bucket) return;
    const text = bucket.texts.join("");
    if (!text) return;
    chapters.push({ label: bucket.label, ancestors: bucket.ancestors, depth: bucket.depth, hrefs: bucket.hrefs, text });
  });
  if (chapters.length) return chapters;
  // Empty or entirely unresolvable TOC: one chapter per spine file, as before.
  return spineHrefs.flatMap((href, index) => {
    const text = segmentText(spineSegments[index] ?? []);
    return text ? [{ label: "", ancestors: [] as string[], depth: 0, hrefs: [href], text }] : [];
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
      href: stripFragment(resolveHref(opfPath, href)),
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
  const spineSegments = spineHrefs.map((href) => parseSpineSegments(fileText(files, href)));
  const chapters = buildOwnedChapters(toc, spineHrefs, spineSegments);
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
    ancestors: chapter.ancestors,
    depth: chapter.depth,
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

function chapterTitleOf(chapter: Chapter): string | undefined {
  if (chapter.ancestors.length) {
    const path = [...chapter.ancestors, chapter.label].filter(Boolean);
    return path.length ? path.join(" › ") : undefined;
  }
  return chapter.label || undefined;
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
    chapterTitle: chapterTitleOf(chapter),
    part: Math.floor(offset / CHAPTER_PART_CHARS),
    match,
    snippet: `${start ? "…" : ""}${chapter.text.slice(start, end)}${end < chapter.text.length ? "…" : ""}`,
  });
}