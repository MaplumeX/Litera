# Chapter ownership vs shipping foliate text (2026-08-14)

## Why not send foliate-extracted bodies to the sidecar

JSONL frames are capped at 1 MiB (`MAX_JSONL_BYTES` in `sidecar/protocol.ts` and `src-tauri/src/sidecar_protocol.rs`). A whole-book extract as one `open_book` / `set_chapters` command will overflow on long EPUBs. Chunking that command is a new protocol and is out of scope for coordinate unification.

Sidecar has no DOM. Foliate `createDocument` / `textContent` cannot run there. Frontend already uses foliate for display; the agent worker still needs local text for FTS5.

## What ReadAware actually fixed

`apps/web/src/features/library/lib/book-text-store.ts` extract v2:

- Flatten TOC (including nested items).
- `book.resolveHref(entry.href)` → spine `index`.
- First TOC entry to claim a section wins (in-file sub-anchors do not steal the whole file).
- Unclaimed sections inherit the previous owner (multi-file chapters).
- Each chapter records `hrefs` = TOC href + owned section ids.
- `findChapterByHref` (`packages/agent/src/text/chapter-lookup.ts`) is the join key for the reading position.

Their v1 (zip flattened titles onto leftover spine files by order) is the bug Litera has now.

## Litera mapping

Port the ownership + href lookup as pure functions next to `sidecar/book-text.ts`. Keep `htmlToText` and in-memory FTS5. Resolve TOC hrefs against the nav/ncx directory, then match onto `spineHrefs` with the same canonical rules (strip fragment, decodeURI, strip leading `../` and `/`, suffix match only on a path boundary).

Frontend locator: foliate `relocate.tocItem.href` (see `src/foliate-js/view.js` `#onRelocate` / `reader.js` `tocItem.href`), else `book.sections[index].id` (spine item href in `epub.js`).

Do not emit `hrefs` to the model (same as `08-13-book-tools-readaware`).
