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