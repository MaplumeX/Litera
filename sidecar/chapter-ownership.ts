/**
 * TOC-owned chapter identity: resolve hrefs onto spine files, first claim wins.
 * Pure helpers so unit tests can import them without FTS WASM.
 */

export interface OwnedChapter {
  index: number;
  label: string;
  hrefs: string[];
  text: string;
}

export interface TocLike {
  label: string;
  href: string;
}

export interface ChapterHrefIndex {
  index: number;
  label: string;
  href?: string;
  hrefs?: readonly string[];
}

export function canonicalHref(href: string): string {
  let value = href.split("#")[0] ?? "";
  try {
    value = decodeURI(value);
  } catch {
    // keep the raw path when decodeURI rejects a malformed escape
  }
  value = value.replace(/\\/g, "/");
  while (value.startsWith("../")) value = value.slice(3);
  while (value.startsWith("/")) value = value.slice(1);
  return value;
}

export function hrefMatches(a: string, b: string): boolean {
  const left = canonicalHref(a);
  const right = canonicalHref(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length > right.length) {
    return left.endsWith(right) && left.charAt(left.length - right.length - 1) === "/";
  }
  if (right.length > left.length) {
    return right.endsWith(left) && right.charAt(right.length - left.length - 1) === "/";
  }
  return false;
}

export function findChapterByHref(
  chapters: readonly ChapterHrefIndex[],
  href: string | undefined,
): ChapterHrefIndex | undefined {
  if (!href) return undefined;
  return chapters.find((chapter) => chapterHrefs(chapter).some((entry) => hrefMatches(entry, href)));
}

export function assignChapterOwners(
  spineHrefs: readonly string[],
  tocHrefs: readonly string[],
): (number | undefined)[] {
  const ownerOf: (number | undefined)[] = spineHrefs.map(() => undefined);
  for (let tocIndex = 0; tocIndex < tocHrefs.length; tocIndex++) {
    const tocHref = tocHrefs[tocIndex];
    if (!tocHref) continue;
    const spineIndex = spineHrefs.findIndex(
      (spineHref, index) => ownerOf[index] === undefined && hrefMatches(tocHref, spineHref),
    );
    if (spineIndex >= 0) ownerOf[spineIndex] = tocIndex;
  }
  let previous: number | undefined;
  for (let index = 0; index < ownerOf.length; index++) {
    const owner = ownerOf[index];
    if (owner !== undefined) previous = owner;
    else if (previous !== undefined) ownerOf[index] = previous;
  }
  return ownerOf;
}

export function mergeOwnedChapters(
  toc: readonly TocLike[],
  spineHrefs: readonly string[],
  spineTexts: readonly string[],
  ownerOf: readonly (number | undefined)[],
): OwnedChapter[] {
  const buckets = toc.map((entry) => ({
    label: entry.label,
    hrefs: [entry.href],
    texts: [] as string[],
  }));
  for (let spineIndex = 0; spineIndex < spineHrefs.length; spineIndex++) {
    const owner = ownerOf[spineIndex];
    if (owner === undefined) continue;
    const bucket = buckets[owner];
    if (!bucket) continue;
    const spineHref = spineHrefs[spineIndex];
    if (spineHref && !bucket.hrefs.some((href) => hrefMatches(href, spineHref))) {
      bucket.hrefs.push(spineHref);
    }
    const text = spineTexts[spineIndex] ?? "";
    if (text) bucket.texts.push(text);
  }
  const chapters: OwnedChapter[] = [];
  for (const bucket of buckets) {
    const text = bucket.texts.join("");
    if (!text) continue;
    chapters.push({
      index: chapters.length,
      label: bucket.label,
      hrefs: bucket.hrefs,
      text,
    });
  }
  return chapters;
}

export function fallbackOwnedChapters(
  spineHrefs: readonly string[],
  spineTexts: readonly string[],
): OwnedChapter[] {
  const chapters: OwnedChapter[] = [];
  for (let index = 0; index < spineHrefs.length; index++) {
    const text = spineTexts[index] ?? "";
    const href = spineHrefs[index];
    if (!text || !href) continue;
    chapters.push({
      index: chapters.length,
      label: "",
      hrefs: [href],
      text,
    });
  }
  return chapters;
}

export function buildOwnedChapters(
  toc: readonly TocLike[],
  spineHrefs: readonly string[],
  spineTexts: readonly string[],
): OwnedChapter[] {
  const anyResolved = toc.some((entry) =>
    spineHrefs.some((spineHref) => hrefMatches(entry.href, spineHref)),
  );
  if (toc.length === 0 || !anyResolved) {
    return fallbackOwnedChapters(spineHrefs, spineTexts);
  }
  return mergeOwnedChapters(
    toc,
    spineHrefs,
    spineTexts,
    assignChapterOwners(spineHrefs, toc.map((entry) => entry.href)),
  );
}

export function formatChapterAside(chapter: ChapterHrefIndex | undefined): string | undefined {
  if (!chapter) return undefined;
  const chapterNumber = chapter.index + 1;
  const title = chapter.label.trim();
  return title
    ? `（当前在「${title}」，第 ${chapterNumber} 章）`
    : `（当前在第 ${chapterNumber} 章）`;
}

function chapterHrefs(chapter: ChapterHrefIndex): readonly string[] {
  if (chapter.hrefs && chapter.hrefs.length > 0) return chapter.hrefs;
  return chapter.href ? [chapter.href] : [];
}
