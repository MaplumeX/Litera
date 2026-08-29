# Implement — Hierarchical TOC with anchor-level chapter splitting

## Checklist

Phase A — parsing foundation (`src/agent/book/epub-content.ts`)

1. [ ] Add `NavNode { label, href, depth }` type; `parseNav` computes depth
       from `<ol>` nesting; `parseNcx` computes depth from `navPoint`
       nesting. Keep fragment in hrefs.
2. [ ] Add `stripFragment(href)` helper; use it for OPF manifest/spine href
       resolution; keep raw fragments on TOC hrefs.
3. [ ] Implement `parseSpineSegments(source): Segment[] { anchorId?, text }`
       (DOM walk, `id`/`<a name>` boundaries, whitespace-normalized text,
       single-segment fallback = current `htmlText`, xmldom-failure fallback
       to `htmlText`).
4. [ ] Unit tests for 1–3 (depth extraction, fragment retention, segment
       slicing first/middle/last, no-anchor file, malformed HTML fallback).

Phase B — ownership v2 (`src/agent/book/epub-content.ts`)

5. [ ] Rewrite `buildOwnedChapters(nodes, spineHrefs, spineSegments)`:
       per-segment ownership, fragment-claim splitting, unclaimed-segment
       propagation to preceding node, unresolvable-fragment fallback (R5),
       pure-container collapse (same target as next deeper node → becomes
       ancestor label only), unclaimed-file propagation, empty-TOC fallback
       (one chapter per spine file).
6. [ ] `Chapter` gains `ancestors: string[]`, `depth: number`; `bookToc`
       exposes them; container entries never become chapters.
7. [ ] Update `parseEpub` to extract segments per spine file and thread
       through; `buildTrigramIndex` unchanged (works over new chapters).
8. [ ] Unit tests: AC1 fixture (nested nav, `#ch1/#ch2/#ch3` one file),
       AC2 (per-file chapters second volume), AC3 (missing/duplicate id
       fallback, no text loss), AC4 (empty TOC fallback), union-of-texts
       invariant test.
9. [ ] `searchBook` hit `chapterTitle` = path join when ancestors exist.

Phase C — projection surfaces

10. [ ] `book-content.ts`: `BookTocEntry` adds `ancestors`, `depth`;
        `chapterAside` prefers exact file+fragment match, falls back to
        file-only `hrefMatches`; aside renders `ancestors › label
        (chapterIndex n)`.
11. [ ] `formatBookSnapshot`: indent by depth, keep entry/char caps, keep
        truncation marker.
12. [ ] `embedded-runtime.ts`: `get_toc` tool maps `path` (ancestors + self),
        `depth`, plus existing fields; update tool description wording.
13. [ ] Update all `BookTocEntry` fakes (embedded-runtime.test.ts, book
        import tests if touched) and existing expected snapshots.

Phase D — verification

14. [ ] `npx vitest run` green (agent + lib suites).
15. [ ] `npx tsc --noEmit` clean.
16. [ ] Stale-reference audit (no leftover `TocItem`-era assumptions, no
        href leaks in tool output/snapshot).
17. [ ] Manual fixture sanity: build the AC1-style EPUB in a quick script or
        test and eyeball `get_toc`/`read_chapter` output once.

## Validation commands

```bash
npx vitest run src/agent/book src/agent/runtime src/lib
npx tsc --noEmit
```

## Review gates

- After Phase B: verify union-of-texts invariant holds on all fixtures
  before touching projection surfaces.
- After Phase C: confirm model-visible outputs (snapshot, get_toc,
  read_chapter, search) contain no hrefs and no new tools.

## Rollback points

- Phase A+B are confined to `epub-content.ts` (+tests): revert file if
  ownership v2 misbehaves; old behavior remains in git history.
- Phase C is additive; each file can be reverted independently.

## Risks

- xmldom `text/html` quirks on real-world EPUBs → segment fallback must be
  tested against a real exported book (Calibre/standard publisher EPUB)
  before release.
- Books with dozens of inline `id`s will explode chapter count; acceptable
  (matches TOC only claims fragments — wait, segments exist for all ids but
  only TOC-claimed ones become chapters; unclaimed segments propagate to the
  preceding TOC node, so chapter count stays == TOC count. Verified in
  design step 3).