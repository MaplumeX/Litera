# Implement: restore reading position via CFI

## Checklist

1. **Types**
   - Optional `lastCfi?: string` on `BookRecord` and `BookOpenContext` in `src/types/library.ts`.
   - Matching `last_cfi: Option<String>` (`rename = "lastCfi"`, `default`, `skip_serializing_if`) on both Rust structs in `src-tauri/src/library.rs`.
   - `ReaderView` `initialCfi?: string`. Do not put CFI on `ReadingSettings`.

2. **Rust persistence**
   - Extend `LibraryStore::update_reading_state` and the Tauri command with `last_cfi: Option<String>`.
   - Independent `Option`; at least one of fraction/settings/mode/layout/cfi required.
   - `Some(last_cfi)` → `validate_cfi` then replace only that field.
   - `validate_library` / book load: present-but-invalid CFI → `StorageCorrupt`.
   - `get_book_open_context` maps `last_cfi`.
   - Update every existing `update_reading_state(...)` call site with the extra `None`.
   - Overwrite/reimport tests keep `lastCfi` the same way they keep `lastFraction`.

3. **Frontend restore / persist**
   - Relocate: debounce one `update_reading_state({ lastFraction, lastCfi })` when CFI is present; fraction-only if CFI is missing.
   - Include that writer in `flushReadingState`.
   - `handleOpenBook`: pass `context.lastCfi` into `ReaderView` as `initialCfi`. Still pass `lastFraction`.
   - Open effect: `init({ lastLocation: initialCfi })` when CFI is set. Do **not** `init({})` then `goTo(cfi)` (`init` without `lastLocation` calls `next()` and would persist page 1).
   - No CFI: keep `init({})` + `goToFraction` when `initialFraction > 0`.
   - Failed CFI restore: `goToFraction` then start. Catch, do not throw out of the open effect.
   - Do not write `lastCfi` / `lastFraction` into `currentBook` on relocate.

4. **Tests**
   - Rust: missing `lastCfi` valid and omitted from JSON; round-trip; does not clobber fraction/settings/mode/layout; invalid CFI rejected on write/load; overwrite keeps CFI; settings-only write leaves CFI.
   - Frontend: reopen calls `init` with `lastLocation` CFI (not only `goToFraction`); fraction-only books still call `goToFraction`; relocate invoke includes `lastCfi` + `lastFraction` and not settings; `currentBook.lastCfi` is not updated on relocate.

5. **Do not**
   - Change scrubber / `BookCard` percent (`lastFraction`).
   - Persist CFI in `localStorage` or `annotations.json`.
   - Bump `schemaVersion`.
   - Synthesize CFI from old fractions.
   - Edit `.trellis/spec/` here — spec update is Phase 3.3 after the code lands.

## Validation

- `cargo test --manifest-path src-tauri/Cargo.toml --lib library`
- Frontend tests that mock `update_reading_state` / `ReaderView.init` (App reader + ReaderView open restore)
- Project lint + type-check

## Risks

- Many Rust `update_reading_state` call sites — signature change is mechanical but must be complete.
- `init({})` then `goToCfi` looks simpler but races persist (first relocate is page 1). Must use `init({ lastLocation })`.
- `handleBookReady` `setStyles` after restore: rely on foliate re-anchoring the CFI range; do not add a second `goToFraction` after styles.

## Rollback

Revert the `lastCfi` field, command arg, and App/ReaderView restore path. Libraries that never wrote `lastCfi` stay readable. Libraries that already wrote it fail old `deny_unknown_fields` (same class as `lastLayout`).
