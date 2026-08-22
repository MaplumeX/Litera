# Restore reading position via CFI

## Goal

Leave a book and reopen it on the same passage the reader was looking at, not an adjacent page or a progress-bar estimate.

## User Value

Progress is already saved, but reopening often lands one page ahead (or further after a layout change). Bookmarks already jump by CFI; the live reading position should do the same.

## Background / Confirmed Facts

- `update_reading_state` persists `lastFraction` (0..=1). Library cards and the scrubber use it as percent. `BookRecord` has no last-position CFI (`src-tauri/src/library.rs:197-198`, `src/types/library.ts:33`).
- Relocate persists `detail.fraction` from foliate `lastLocation`. That value is **end-of-current-page** book progress (`paginator.js` `#afterScroll` start-of-page + `size`, then `SectionProgress.getProgress` uses `nextSize`).
- Reopen restores with `goToFraction(initialFraction)` after `init({})` (`ReaderView.tsx:786-791`). `init({})` with no `lastLocation` calls `next()` (first page). `goToFraction` maps the saved end-of-page fraction through `Math.round(anchor * (textPages - 1))`, so with unchanged pagination it typically lands on the **next** page.
- Foliate supports exact restore: `init({ lastLocation: cfi })` → `resolveCFI` → range anchor (`view.js:314-318`, `446-453`). Relocate already emits `lastLocation.cfi`. `ReaderView` keeps it in `lastLocationRef` / `getLocation()` and already has `goToCfi`. Bookmarks/highlights persist CFI with `validate_cfi` (`epubcfi(...)`, max 8 KiB).
- `handleBookReady` applies `setStyles` after the restore (`App.tsx:589-593`). Fraction restore then reflows; a CFI/range anchor can re-scroll to the same text.
- Relocate does not write `lastFraction` into `currentBook` (avoids re-opening the `[fileData, initialFraction]` effect). Debounced persist flushes on back-to-library, another book, and window close.
- Overwrite import keeps `lastFraction` / `settings` / `lastOpenedAt` / `lastReaderMode` / `lastLayout`. `library.json` stays `schemaVersion: 1`; optional shelf fields use `serde(default)` + `skip_serializing_if`. `BookRecord` is `deny_unknown_fields` (same downgrade class as `lastLayout`).
- `update_reading_state` takes independent Options (`lastFraction`, `settings`, `lastReaderMode`, `lastLayout`); at least one required. A settings-only write must not clear position.

## Key Decisions

- **Locator = CFI. Percent = `lastFraction`.** Reopen uses CFI. Scrubber seek, library-card percent, and progress display stay on `lastFraction`.
- **Store `lastCfi` on the book record**, next to `lastFraction`, via `update_reading_state`. Not `annotations.json`, not `localStorage`, not `ReadingSettings`.
- **No `schemaVersion` bump.** Missing `lastCfi` is valid.
- **Fallback:** no CFI → existing `goToFraction(lastFraction)` (upgrade / never-relocated). CFI resolve fails → same fallback, then first page.
- **Overwrite import keeps `lastCfi`** with the other shelf fields.

## Requirements

- **POS-1**: Persist the current visible CFI (`epubcfi(...)`) per book, same debounce/flush cadence as `lastFraction`.
- **POS-2**: Reopening that book (back to library, another book, or process restart) restores via CFI so the previously visible text is on screen when typography and viewport match.
- **POS-3**: Keep writing `lastFraction`. Library cards and the scrubber stay percent-based. Seeking the scrubber still uses `goToFraction`.
- **POS-4**: A book with `lastFraction` but no `lastCfi` still restores approximately via `goToFraction` (today’s path). A book with neither opens at the start.
- **POS-5**: If stored CFI cannot be resolved (replaced EPUB, bad locator), fall back to `lastFraction`, then the start. Do not crash the reader.
- **POS-6**: Writing CFI must not clear `lastFraction`, `settings`, `lastReaderMode`, or `lastLayout`. Writing those must not clear `lastCfi`.
- **POS-7**: Overwrite/reimport of the same book keeps `lastCfi`. Deleting the book removes it with the record.
- **POS-8**: Do not write `lastCfi` into `currentBook` on every relocate (same re-open trap as `lastFraction`).

## Acceptance Criteria

- [ ] AC-1: Open a book, turn to a middle page, return to the library, reopen → the previously visible passage is on screen (not the next page, not chapter 1).
- [ ] AC-2: Same as AC-1 after quitting the app and launching again.
- [ ] AC-3: Library card percent still tracks `lastFraction`. Dragging the scrubber still seeks by fraction.
- [ ] AC-4: A book that only has `lastFraction` (no `lastCfi`) still opens near that progress via `goToFraction`.
- [ ] AC-5: `update_reading_state({ lastCfi })` does not wipe fraction/settings/mode/layout; a settings-only or layout-only write does not wipe `lastCfi`.
- [ ] AC-6: Overwrite import of the same book keeps `lastCfi`.
- [ ] AC-7: Unresolvable CFI does not hang or white-screen; reader falls back to `lastFraction` or the start.

## Out of Scope

- Changing scrubber math, library-card percent, or `lastFraction` display semantics.
- Notes, bookmarks, highlights, or a second position store in chat/agent state.
- Cloud sync, exporting CFI, or migrating old fractions into synthesized CFIs.
- Reordering `setStyles` except as needed for CFI restore to stick.
- Bumping `library.json` `schemaVersion`.
