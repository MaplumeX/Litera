# Quality Guidelines

## Embedded Agent boundary

- `LiteraAgentRuntime` is the only Agent loop. One active book worker, session,
  and prompt are allowed at a time.
- Provider imports must remain browser-compatible and pinned to the matching
  `pi-ai` / `pi-agent-core` version.
- The raw user message is appended before the network call. Completed assistant
  and tool-result messages are appended only after settlement.
- Abort persists the terminal aborted assistant message when Pi settles.

## Book tools and coordinates

- `chapterIndex` always indexes the TOC-owned chapter projection, never raw spine
  files. The reader sends `chapterHref`; the runtime resolves ownership.
- `read_chapter` is bounded by 12,000-character parts. Search accepts multiple
  query variants, prefers exact hits, and returns deterministic bounded snippets.
- EPUB parsing, ownership, indexing, and search run in the module worker. A book
  switch terminates the old worker and rejects pending calls.
- `list_annotations` is a no-arg read of the current book's `annotations.json`
  via `get_annotations`. It is not injected into `bookSnapshot` or
  `readingContext`. Return `{ bookmarks, highlights }` JSON text: each item
  keeps `id`, `cfi`, `createdAt`; bookmarks also `fraction` and optional
  `label`; highlights keep `excerpt`. Omit `label` when unset. Empty arrays are
  success. Do not call `save_annotations`. Do not invent chapter titles. Gate
  with the same `bookCall` / `bookId` check as the text tools.
- Tool results are read-only in chat; there is no clickable tool-result →
  reader-location jump, so no runtime `chapterIndex` → href resolution is needed.
  Reader jumps stay chrome-owned (`goToChapterHref` / `goToTocItem` for TOC and
  prev/next, `jumpToAnnotation` for annotation drawers). Never resolve
  `flattenToc(readerToc)[i]` and do not add an `open_in_reader` model tool.

## Session integrity

- Pi v3 JSONL remains append-only during normal interaction.
- Rust validates real paths, ids, timestamps, parents, byte caps, and expected
  leaves. Stale writers fail rather than silently forking.
- Only an invalid trailing fragment may be truncated. Earlier corruption is an
  error. v1/v2 migrations require a backup and atomic replacement.

## Network and credentials

- Model requests use `createGuardedNativeFetch`, require the configured HTTP(S)
  origin, and reject redirects.
- API keys exist only in Rust-owned config files and request memory. Never put
  them in local storage, sessions, logs, errors, or snapshots.

## Required gates

Run frontend tests/type-check/build, Rust tests, `tauri build --no-bundle`, and
the stale-reference audit before release.

On Windows CI, the `windows-thumbnail` cdylib must be built (`cargo build
--release` in `src-tauri/windows-thumbnail/`) before `cargo test` and
`tauri build` so the `tauri.windows.conf.json` `bundle.resources` DLL exists.
Non-Windows builds never list that path, so `tauri build.rs` does not require
the file; the real DLL is never compiled on macOS/Linux.
