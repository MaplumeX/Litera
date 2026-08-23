export interface TocTreeItem {
  href: string;
  label: string;
  subitems?: TocTreeItem[];
}

export interface FlattenedTocItem {
  href: string;
  label: string;
}

/** Depth-first TOC walk. Items without an href are skipped. */
export function flattenToc(toc: TocTreeItem[]): FlattenedTocItem[] {
  const out: FlattenedTocItem[] = [];
  const walk = (items: TocTreeItem[]) => {
    for (const item of items) {
      if (item.href) out.push({ href: item.href, label: item.label });
      if (item.subitems?.length) walk(item.subitems);
    }
  };
  walk(toc);
  return out;
}

export interface ChapterNav {
  canPrev: boolean;
  canNext: boolean;
  prevHref?: string;
  nextHref?: string;
}

/** Prev/next chapter from a flattened TOC, keyed by the current `chapterHref`. */
export function chapterNavAt(toc: TocTreeItem[], chapterHref?: string): ChapterNav {
  const items = flattenToc(toc);
  if (items.length === 0 || !chapterHref) {
    return { canPrev: false, canNext: false };
  }
  const index = items.findIndex((item) => item.href === chapterHref);
  if (index < 0) return { canPrev: false, canNext: false };
  return {
    canPrev: index > 0,
    canNext: index < items.length - 1,
    prevHref: index > 0 ? items[index - 1].href : undefined,
    nextHref: index < items.length - 1 ? items[index + 1].href : undefined,
  };
}

/** Sibling-index path key. Unique for a given TOC tree even when hrefs repeat. */
export function tocPathKey(path: number[]): string {
  return path.join(".");
}

/** DFS keys of rows that have at least one child. */
export function collapsibleKeys(toc: TocTreeItem[]): string[] {
  const out: string[] = [];
  const walk = (items: TocTreeItem[], path: number[]) => {
    items.forEach((item, index) => {
      if (!item.subitems?.length) return;
      const key = tocPathKey([...path, index]);
      out.push(key);
      walk(item.subitems, [...path, index]);
    });
  };
  walk(toc, []);
  return out;
}

/**
 * Collapsible ancestors of every `item.href === href` match (DFS).
 * The matching row itself is not included. Missing/unmatched href → `[]`.
 */
export function ancestorKeysForHref(toc: TocTreeItem[], href?: string): string[] {
  if (!href) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (items: TocTreeItem[], path: number[], ancestors: string[]) => {
    items.forEach((item, index) => {
      const key = tocPathKey([...path, index]);
      if (item.href === href) {
        for (const ancestor of ancestors) {
          if (seen.has(ancestor)) continue;
          seen.add(ancestor);
          out.push(ancestor);
        }
      }
      if (item.subitems?.length) {
        walk(item.subitems, [...path, index], [...ancestors, key]);
      }
    });
  };
  walk(toc, [], []);
  return out;
}

/** Keep `current` order; append unseen keys. Return `current` when unchanged. */
export function unionKeys(current: string[], extra: string[]): string[] {
  const seen = new Set(current);
  const out = [...current];
  let added = false;
  for (const key of extra) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    added = true;
  }
  return added ? out : current;
}
