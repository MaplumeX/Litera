# Design: unify reader and agent chapter coordinates

## Boundaries

| Layer | Change |
|---|---|
| `sidecar/book-text.ts` | Pure ownership + href helpers (no WASM) |
| `sidecar/book.ts` | Build TOC-owned chapters after parse; FTS + accessors use that list; keep raw `href` on internal TOC |
| `sidecar/index.ts` | Resolve `context.chapterHref` for the reading-context aside; stop treating the integer as a spoken chapter |
| `sidecar/protocol.ts` + `src-tauri/src/sidecar_protocol.rs` + frontend prompt invoke | `PromptContext.chapterHref` |
| `ReaderView` / `App` / `ChatPanel` / `use-agent-bridge` / `AgentMessage` | Capture and forward href; drop spine `chapterIndex` as the locator |
| Tests | Ownership, href match, protocol, reader capture, existing snapshot/search |

Frontend does not send chapter bodies. Sidecar still unzip + `htmlToText`.

## Chapter model

After `parseEpub` + spine text extract:

1. Flatten TOC (sidecar nav/ncx parsers are already flat).
2. Resolve each TOC href relative to the nav/ncx directory (same base as today's `resolveHref(opfDir, …)` but using the TOC file's directory).
3. Map resolved href → spine index with `hrefMatches`.
4. `ownerOf[section] = first TOC entry that resolves to that section`.
5. Forward-fill unowned sections from the previous owner.
6. Concatenate owned texts (skip empty). Drop a would-be chapter with no text.
7. Each kept chapter: `{ index, label, hrefs: [tocHref, ...sectionHrefs], text }`.
8. If TOC is empty or no href resolves: one chapter per non-empty spine file; `hrefs = [spineHref]`.

`currentBook.chapterTexts` and FTS `rowid` use this owned index (still `rowid = index + 1`). `getToc()` `chars` is `text.length`. `metadata.totalChapters` is owned-list length.

`linear="no"` is not parsed today; do not add it in this task.

## Prompt locator

```
PromptContext { selection?: string; chapterHref?: string }
```

Remove `chapterIndex` from the live prompt path. `deny_unknown_fields` on the Rust struct: ship TS + Rust + sidecar decoders together.

Reader:

- On `relocate`, keep `detail.index` only for UI progress if needed.
- Locator for chat = `detail.tocItem.href` if present, else `view.book.sections[detail.index].id`.
- Selection capture carries that href, not the spine index.

Sidecar aside (no selection):

1. `findChapterByHref(ownedToc, chapterHref)`.
2. If found: `（当前在「{title}」，第 {chapterNumber} 章）`. Untitled fallback: `（当前在第 {chapterNumber} 章）`.
3. If missing/absent: omit the chapter line (do not print a raw integer).

`hrefs` never appear in snapshot, `get_toc` JSON, or the aside.

## Data flow

```
foliate relocate / selection
  → chapterHref (tocItem.href or section.id)
  → prompt/edit_prompt context
  → sidecar findChapterByHref(owned chapters)
  → readingContext aside

open_book path
  → sidecar parse spine + TOC
  → own sections → chapterTexts + FTS
  → snapshot / get_toc / read_chapter / search_in_book
```

## Compatibility

- Protocol v1 stays; field swap inside `PromptContext` is a same-release lockstep change.
- Old transcripts that recorded previous tool `chapterIndex` values are display-only (`08-13-book-tools-readaware` R7).
- No library.json / booktext blob / session rewrite.

## Trade-offs

- **Ownership in sidecar, not foliate extract.** Unifies the index without a 1 MiB JSONL dump and without a DOM in the worker. Text may still differ slightly from on-screen `textContent`; that is accepted under PRD out of scope.
- **Href instead of a frontend-resolved integer.** Avoids duplicating ownership in the webview. Sidecar is the only place that assigns `chapterIndex`.
- **Keep regex EPUB parse.** Replacing it is a different task; href resolution is the missing join key.

## Rollback

Revert the listed files. No data migration. After revert, prompts must not send `chapterHref` (old decoder rejects unknown fields).
