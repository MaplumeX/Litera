# Hierarchical TOC with anchor-level chapter splitting

## Goal

Make the agent's chapter list match the table of contents the human reader
sees: preserve TOC hierarchy (卷 › 部 › 章), and split spine files at TOC
anchor targets so a "small chapter" (several per spine file) is its own
`read_chapter` target. The agent must be able to (a) tell which level a chapter
sits at and where it sits among its ancestors, and (b) read only that small
chapter's text when asked.

## Background / Current Behavior (confirmed from code)

- `parseNav` / `parseNcx` (`src/agent/book/epub-content.ts`) flatten every
  nested entry into one linear list; depth is discarded.
- `resolveHref` strips `#fragment`; ownership in `buildOwnedChapters` is
  per-spine-file with "first TOC entry to claim a file wins". When several TOC
  entries point into the same spine file, only the first owns the file; the
  others end up with no text and are dropped from the chapter list entirely.
- `htmlText` returns `documentElement.textContent` with all heading markup
  lost; `read_chapter` windows that flat text.
- `get_toc` / `formatBookSnapshot` / `chapterAside` render a flat list, so the
  model cannot see "第一章 belongs to 第一卷" nor distinguish same-file
  small chapters.

## Requirements

1. **R1 Hierarchical TOC** — `parseNav` keeps the `<ol>` nesting depth, and
   `parseNcx` keeps `navPoint` nesting depth. Each projected entry carries
   depth (or an ancestors path) so `get_toc` and the book snapshot can render
   the same hierarchy the reader sees (e.g. indented lines or
   `第一卷 › 第二章 › 母亲的信`).
2. **R2 Anchor-level splitting** — When a TOC entry's resolved href carries a
   `#fragment`, ownership must be the text slice inside that spine file
   starting at the anchor element (the element with matching `id`/`name`)
   through the start of the next anchor in that file (or the file end).
   Entries without a fragment keep file-level ownership.
   The chapter list must contain every non-empty-text TOC entry, including
   several entries sharing one spine file.
3. **R3 Precise reading** — `read_chapter(chapterIndex)` returns only that
   entry's owned slice. `get_toc` / snapshot `chars` equals the slice length.
   Search hits (`search_in_book`) report the new fine-grained `chapterIndex`
   and the entry's full hierarchical title path.
4. **R4 Tool surface unchanged** — Keep `get_book_metadata`, `get_toc`,
   windowed `read_chapter` (12k parts), multi-query `search_in_book`. Add
   hierarchy fields to results; do not add new tools, `bookId`, spoiler
   flags, or a second numbering scheme.
5. **R5 Fallbacks never lose content** — If the anchor `#fragment` does not
   resolve in the spine file (missing id, duplicate id, or unparseable
   fragment), fall back to current behavior for that entry (whole-file merge
   into the previous owner or first claimer). The union of all chapter text
   must always equal the full spine text; no chapter silently disappears.
6. **R6 Reading-position compatibility** — The reader's `chapterHref` (which
   may carry `#fragment` or be a raw section href) must still resolve to one
   chapter on the new list via `chapterAside`; the aside names the chapter by
   hierarchical path + `chapterIndex`. TOC entries remain hidden from the
   model (`hrefs` never appear in tool output or snapshot).
7. **R7 Protocol / compat** — Stdio protocol and worker RPC methods stay the
   same. `chapterIndex` values may shift (finer list); old session JSONL is
   display-only. The trigram/FTS index rebuilds from the new chapter list on
   open. Frontend types tolerate the new optional hierarchy fields.

## Out of Scope

- Letting the agent read a whole "卷" (volume) as one target, or any
  volume-level aggregation tool.
- Changing `read_chapter` text to include heading markup (that is the
  separate `feat/read-chapter-heading-levels` idea; this task keeps text
  plain).
- Reader UI TOC tree changes, foliate rendering, or viewport text.
- Clickable tool-result jumps (removed by 08-18) stay removed.

## Acceptance Criteria

- [ ] AC1 Fixture: nav TOC with `第一卷` (level 1) containing three nested
      chapter anchors `vol1.xhtml#ch1/#ch2/#ch3` in one spine file. `get_toc`
      returns 3 entries with depth/ancestors showing they are children of
      `第一卷`; `read_chapter` of the middle entry returns only that anchor's
      slice; `chars` equals slice length.
- [ ] AC2 Fixture: second volume with one chapter per file keeps file-level
      ownership; hierarchy renders as expected (volume is a container
      heading, not a readable chapter — see design).
- [ ] AC3 Same-file anchors: entries `#sec1`/`#sec2` in one file each own
      their slice; a third entry whose `#secX` id does not exist in the file
      falls back per R5 and no text is lost.
- [ ] AC4 Empty/unusable TOC falls back to one chapter per spine file (as
      today), no regression.
- [ ] AC5 `chapterAside` on a reader href with fragment (e.g.
      `text/vol1.xhtml#ch2`) resolves to the fine-grained chapter and names
      its hierarchical path; hrefs remain hidden from the model.
- [ ] AC6 Snapshot still obeys `BOOK_SNAPSHOT_MAX_TOC_CHARS` /
      `MAX_TOC_ENTRIES`, renders hierarchy (indentation), and points to
      `get_toc` when truncated. `get_toc` JSON now includes depth/ancestors
      fields.
- [ ] AC7 Existing tests updated; new unit tests cover depth extraction
      (nav nested `ol`, ncx nested `navPoint`), anchor slicing (first /
      middle / last segment), missing-id fallback, duplicate-id fallback,
      and href-with-fragment → chapter resolution.
- [ ] AC8 Frontend `tsc`, vitest, and worker integration tests pass; the
      stale-reference audit stays clean.

## Notes

- `volume headings` that own no text (a TOC entry whose href equals its first
  child's href, e.g. `第一卷 → vol1.xhtml#ch1`) must not produce duplicate or
  empty chapters; resolve during design (see design.md "Container entries").