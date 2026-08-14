# Unify reader and agent chapter coordinates

## Goal

When the reader asks about the current chapter or a named chapter, the agent must read the same prose the reader is looking at. The book snapshot, `get_toc`, `read_chapter`, `search_in_book`, and the per-turn reading-position aside all use one chapter list.

## Background

`08-13-book-tools-readaware` copied ReadAware tool contracts (`chapterNumber`, 12000-char windows, multi-query search) and deferred TOC/spine alignment. That leftover is the accuracy gap.

The reader reports foliate `relocate.detail.index` (spine section). Sidecar `chapterTexts` is also spine-keyed, but TOC entries get a separate sequential `index` from `nav.xhtml` / `toc.ncx` and never resolve `href` to a spine file (`sidecar/book.ts` `parseNavToc` / `parseNcxToc`). Snapshot, `get_toc`, and search titles use the TOC sequence; `read_chapter` and FTS use spine keys. The aside prints the spine integer as `（当前在第 N 章）`.

ReadAware extract v2 assigns each spine section to a flattened TOC entry via `resolveHref`, merges multi-file chapters, and stores `hrefs` so a reading-position href maps back to `chapterIndex`. Their v1 (zip titles by position) is the same class of bug.

## Requirements

1. **R1 One chapter list** — Snapshot, `get_toc`, `read_chapter`, and `search_in_book` index the same list. Spoken "chapter N" is `chapterNumber` N on that list. `read_chapter({ chapterIndex })` returns that entry's prose.
2. **R2 TOC-owned chapters** — A chapter is a flattened TOC entry plus the spine files it owns. Ownership: resolve each TOC `href` onto a spine file; first TOC entry to claim a file wins; unclaimed files join the previous owner. Empty or unresolvable TOC falls back to one chapter per spine file.
3. **R3 Reader position uses the same list** — The prompt locator is a chapter href from foliate (`tocItem.href`, else current section `id`), not a raw spine index. Sidecar resolves it through the chapter's `hrefs` and names the chapter by title + `chapterNumber` in the reading-context aside.
4. **R4 Honest titles and lengths** — `title` / `chars` / snapshot `totalChapters` describe the owned-list text `read_chapter` returns for that `chapterIndex`.
5. **R5 Tool surface unchanged** — Keep `get_book_metadata`, `get_toc`, windowed `read_chapter`, multi-query `search_in_book`. Do not add `bookId`, spoiler flags, viewport text, or a second numbering scheme for the model. Snapshot and `get_toc` still omit hrefs.
6. **R6 Compatibility** — Ship frontend and protocol together. Old session JSONL is display-only. In-memory FTS5 stays the search index and is rebuilt from the owned-list texts on open.

## Acceptance Criteria

- [ ] AC1 Fixture EPUB with a cover (or other unlabeled spine file) plus a chapter split across two XHTML files: `get_toc` has one entry per labeled TOC chapter (not per spine file); `read_chapter` of the first labeled chapter returns that chapter's prose, not the cover; the split chapter is one `read_chapter` target whose text contains both files.
- [ ] AC2 A prompt sent while the reader is on that first labeled chapter produces a reading-context aside that names that chapter's title and `chapterNumber`, and `read_chapter` / search hits for that question use the same `chapterIndex` as snapshot / `get_toc`.
- [ ] AC3 Snapshot `Total chapters` equals owned-list length and matches `get_toc` length; `chars` on a TOC entry equals the text length `read_chapter` windows for that index.
- [ ] AC4 An EPUB with no usable nav/ncx still opens: one chapter per spine file; a prompt href still resolves to one of those chapters.
- [ ] AC5 Existing sidecar tests pass; new unit tests cover href canonicalization, ownership (cover + split file), and href → chapter lookup. Frontend protocol types accept `chapterHref`.

## Out of Scope

- Viewport `visible_text` / reading_cursor injection
- Spoiler fence, `confirmSpoiler`, `throughChapterIndex`
- Persisting extracted text across restarts (`booktext:` blobs)
- Replacing sidecar `htmlToText` with foliate `textContent` / `createDocument`
- Sending full chapter bodies over the 1 MiB JSONL protocol
- Non-EPUB formats
- Cross-book search, memory, annotations
- Changing window size / query caps
- Rewriting the NCX/nav regex parser beyond href resolution and ownership
- Changing the reader TOC sidebar tree

## Technical Notes

- Sidecar remains the text owner (FTS + tools). Chapter *identity* is TOC-owned via href → spine mapping, ported from ReadAware extract v2 without a DOM.
- Foliate `relocate` already exposes `tocItem.href`; section `id` is the spine item href. The frontend forwards one of those strings as `context.chapterHref`.
- `hrefs` stay off the model-facing TOC. They exist only for sidecar lookup and tests.
