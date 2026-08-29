# Design — Hierarchical TOC with anchor-level chapter splitting

## Current data flow (src/agent/book/epub-content.ts)

```
parseEpub(buffer)
  unzip → container.xml → book.opf
  manifest items → spineHrefs[]
  nav.xhtml (parseNav) or toc.ncx (parseNcx) → TocItem[] { label, href }   ← flat, fragment stripped by resolveHref
  htmlText per spine file → spineTexts[]
  buildOwnedChapters(toc, spineHrefs, spineTexts) → Chapter[] { label, hrefs[], text }  ← per-file ownership
  buildTrigramIndex(chapters)
```

Problems: (1) flat TOC — depth discarded; (2) first-claimer wins per file —
same-file TOC entries with empty text are dropped; (3) plain textContent
extraction gives no way to slice by anchor.

## New data flow

```
parseEpub(buffer)
  manifest/spine unchanged
  parseNav/parseNcx → NavNode[] { label, href(with #fragment), depth, children? }  (flat list + depth is enough)
  spine extraction: parseSpineSegments(href, htmlSource)
      → Segment[] { anchorId?, text }        ← DOM-walk, splits at anchor elements
  buildOwnedChapters(nodes, spineHrefs, segments)
      → Chapter[] { label, ancestors[], hrefs[], text }
  bookToc → BookTocEntry { index, label, ancestors[], hrefs[], chars }
```

### Step 1: TocItem → NavNode with depth

`parseNav`: walk `<a>` elements inside the toc `<nav>`; depth = number of
ancestor `<ol>` elements inside the nav minus 1 (nav's direct `ol` = depth 0).
`@xmldom/xmldom` exposes `parentNode`, so a simple loop-up suffices.

`parseNcx`: `navPoint` elements nest; depth = count of ancestor `navPoint`s.
Note the current ncx parser walks `getElementsByTagName("navPoint")` — keep
that but compute depth via ancestor chain. NCX `content src` may also carry
`#fragment` — keep it (do not strip in resolveHref; strip only when matching
spine files).

`resolveHref` keeps the fragment: change to return canonical path + fragment.
File matching continues to use `hrefMatches` (fragment-insensitive, unchanged
semantics); anchor matching uses the raw fragment.

### Step 2: spine text extraction with anchors — parseSpineSegments

Replace `htmlText(source)` with a DOM-based extractor:

```
function parseSpineSegments(source): Segment[]
```

- Parse with `@xmldom/xmldom` (`text/html` mime as today).
- Walk `document.body` (or documentElement) in document order
  (`childNodes` recursion).
- An element starts a new segment iff it has non-empty `id` (or is `<a
  name=...>` for EPUB2 legacy anchors). Record `anchorId`, start a new
  segment buffer.
- Text inside each element is appended to the current segment (same
  whitespace normalization as today: collapse `\s+` → single space).
- If no anchors exist → one segment with `anchorId: undefined` covering the
  whole file (equivalent to today's `htmlText`).
- Segment text = content from its anchor element to the start of the next
  anchor element (or EOF). The anchor element's own text (e.g. the `<h2>`
  heading words) belongs to its segment.

Guardrails:
- Skip anchors that are inline/empty (an `id` on a `<span>` mid-paragraph):
  still a segment boundary — acceptable; TOC anchors in practice target
  headings. R5 fallback covers misuse.
- Malformed HTML that xmldom cannot represent: fall back to
  `htmlText(source)` single-segment (never lose the file).

### Step 3: anchor-aware ownership — buildOwnedChapters v2

Ownership becomes per **segment** instead of per file:

1. For every NavNode in document order, resolve its target spine file via
   `hrefMatches` (fragment ignored for file resolution).
2. Within the file, if the node's fragment matches a segment's `anchorId`,
   the node owns that segment's text. Several nodes may claim segments of
   the same file — all win (first-claimer-wins only applies to *duplicate
   claims of the same segment*).
3. No fragment → the node owns the file's first unclaimed segment? No —
   semantics: a no-fragment node owns the whole file minus segments claimed
   by later nodes with fragments... Too complex; keep it simpler:
   - Compute per-segment owners: walk spine files in order; for each file,
     collect the NavNodes whose target file it is, in TOC order. If **all**
     such nodes have resolvable fragments → segments are split among them;
     unclaimed segments (text before the first anchor, or anchors not in
     TOC) join the **preceding** node (first node for leading text).
   - If a node's fragment is unresolvable → that node falls back to joining
     the previous claimer's bucket (R5); if it is the first for the file and
     nothing precedes, it claims the whole file and later resolvable
     fragment nodes still split their segments out.
   - No node has a fragment (today's common case) → whole file to the first
     node (current behavior preserved).
4. Container entries (PRD Notes): a node whose `depth < child depth` and
   whose href/fragment equals its first child's target is a *pure
   container*: it must not create its own chapter; its label becomes part of
   its children's `ancestors`. Detection: same resolved file + same
   fragment as the next node at deeper depth.
5. Files not claimed by any node: join the previous node's chapter (current
   behavior). Files before the first claim: join the first claimer
   (current behavior via `previous` propagation — keep).
6. Empty-TOC fallback: one chapter per spine file, `ancestors: []`,
   `label: ""` — unchanged.
7. Every non-empty-text node keeps its own chapter: chapters no longer get
   dropped for lack of text ownership. A node that ends with zero text
   (all its content owned by a *sibling* fallback) is dropped only if its
   text slice is empty — but then it should have merged per R5. Keep the
   invariant: **union of all chapter texts == union of all spine texts**.

### Step 4: projection surfaces

`BookTocEntry` (book-content.ts):

```ts
export interface BookTocEntry {
  index: number;
  label: string;
  ancestors: string[];   // NEW: ancestor labels root→parent (volumes/parts)
  depth: number;         // NEW: 0 = top level
  hrefs: string[];       // unchanged, still hidden from the model
  chars: number;
}
```

`bookToc()` fills `ancestors`/`depth` from the Chapter.

`get_toc` tool (embedded-runtime.ts) maps to:

```json
{ "chapterIndex": 3, "chapterNumber": 4, "title": "第二章 母亲的信",
  "path": ["第一卷 出走", "第二章 母亲的信"], "depth": 1, "chars": 7200 }
```

(`path` includes self label; `ancestors` alone is ambiguous for the model —
self-inclusive path reads better in answers.)

`formatBookSnapshot`: render with two-space indentation per depth:

```
Table of Contents (6 of 42 entries):
0 [index 0]: 第一卷 出走
  1 [index 1]: 第一章 火车站
  2 [index 2]: 第二章 母亲的信
```

Same `BOOK_SNAPSHOT_MAX_TOC_CHARS`/`MAX_TOC_ENTRIES` caps (entry = line,
indentation counts toward char budget).

`chapterAside`: match href (with fragment) against `entry.hrefs` — `hrefs`
must now record `file#fragment` strings. Matching: first try exact
file+fragment match; fall back to `hrefMatches` (file-only) when the reader
sends a bare section href or an unmatched fragment. Aside text:

```
Current chapter: 第一卷 出走 › 第二章 母亲的信 (chapterIndex 2)
```

`search_in_book` hits: `chapterTitle` becomes the full path join when
ancestors exist (label otherwise). Trigram index rebuilds from the new
chapter texts automatically (it maps over `chapters`).

### Step 5: worker / protocol

`epub.worker.ts` unchanged method surface (`open/metadata/toc/readChapter/
search`). New fields ride along the same `toc` response. No protocol
version bump needed (additive fields).

## Compatibility

- Old session JSONL: display-only; stale `chapterIndex` values in history are
  not replayed into tools. New snapshots replace old ones per-turn via the
  existing `hasSnapshot` branch (a `bookSnapshot` custom message exists → not
  re-sent; fine since old snapshots are still readable flat lists).
  Note: a session created before this change keeps its old flat snapshot
  until a new session is started. Acceptable; document in journal.
- `BookContentPort` interface: additive `ancestors`/`depth` on `BookTocEntry`
  — all implementers updated in the same commit (worker + tests + fakes in
  embedded-runtime.test.ts).
- `hrefMatches` semantics unchanged (fragment-insensitive file compare);
  `resolveHref` now retains fragments — audit existing callers
  (`parseNav`, `parseNcx`, manifest href resolution): manifest resolution
  must strip fragments (OPF hrefs never have them, but keep behavior
  explicit via a `stripFragment` helper).

## Trade-offs

- **Segment boundary = any `id` element** may split mid-paragraph for books
  with inline anchors; the split text still reconstructs the full file, and
  TOC-claimed slices are exact. Alternative (only `h1-h6`/sectioning
  elements start segments) misses EPUB2 `<a name>` and div-anchored
  chapters; rejected.
- **Depth from DOM ancestor counting** on xmldom: robust for well-formed
  nav; malformed navs produce depth-0 flat lists — acceptable (R5 class).
- **No volume-level read target**: volumes are paths, not chapters (per
  Out of Scope); model can read children individually.

## Testing shape

- `epub-content.test.ts`: extend fixture builder with `nav` nested `<ol>`
  (two levels), multi-anchor single-file volume, ncx nested `navPoint`,
  missing-id fragment, duplicate-id, EPUB2 `<a name>` anchor, inline-span
  anchor. Cover AC1–AC4, AC7.
- `book-content.test.ts`: `chapterAside` with fragment href; snapshot
  indentation + truncation with depth; `get_toc` mapping shape in
  `embedded-runtime.test.ts` (path/depth fields present).
- Worker tests unchanged in shape; add hierarchy fields to expected TOC.