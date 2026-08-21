# Implement: per-book reader layout persistence

## Checklist

1. **Types**
   - Add `ReaderLayout` in `src/types/library.ts` and optional `lastLayout` on `BookRecord` + `BookOpenContext`.
   - Add matching Rust `ReaderLayout` and `last_layout` on `BookRecord` + `BookOpenContext` in `src-tauri/src/library.rs`.
   - Add `src/lib/reader-layout.ts` with defaults + `resolveReaderLayout` (mirror `reader-mode.ts`).

2. **Rust persistence**
   - Extend `LibraryStore::update_reading_state` and the Tauri command with `last_layout: Option<ReaderLayout>`.
   - Independent `Option`; at least one of fraction/settings/mode/layout required.
   - Map through `get_book_open_context`.
   - Validate on write (`InvalidInput`) and on `validate_library` load (`StorageCorrupt`).
   - Update every existing Rust `update_reading_state(...)` call site with the extra `None` (or `Some(layout)` in new tests).
   - Overwrite/reimport tests should keep `lastLayout` the same way they keep `lastReaderMode`.

3. **Frontend restore / persist**
   - `handleOpenBook`: restore via `resolveReaderLayout(context.lastLayout)` instead of hard-coded reset.
   - Debounced `persistLayout` + include it in `flushReadingState`.
   - Schedule persist when chat/book/session-rail actually change (toolbar toggles, selection opening chat, TOC/annotations expanding book).
   - Remove Agent-entry `setSessionRailOpen(true); setBookCollapsed(false)` in `handleReaderModeChange`.
   - Leave `handleBackToLibrary` process reset; flush happens first.

4. **Tests**
   - Rust: missing `lastLayout` valid and omitted from JSON; round-trip; does not clobber fraction/settings/mode; invalid object rejected; overwrite keeps layout.
   - Frontend (`App.reader-mode.test.tsx` or sibling): restore saved layout on open; book B does not inherit book A; first-open defaults; mode switch does not expand collapsed book/rail; `update_reading_state` receives `lastLayout` and not the other fields.

5. **Do not**
   - Change pane-width `localStorage` keys.
   - Persist `tocVisible` / `annotationsVisible`.
   - Put layout on `ReadingSettings` or `preferences.json`.
   - Bump `schemaVersion`.
   - Edit `.trellis/spec/` here — spec update is Phase 3.3 after the code lands.

## Validation

- `cargo test --manifest-path src-tauri/Cargo.toml --lib library`
- Frontend tests covering App reader mode / annotations that mock `update_reading_state` (update call-shape if they assert arity/fields).
- Project lint + type-check.

## Risks

- Many Rust test call sites for `update_reading_state` — signature change is mechanical but must be complete.
- Existing “switch to Agent” tests that assume book/rail reset: re-read and keep only those that still hold with defaults (book starts expanded). Add an explicit AC-5 case for collapsed-then-switch.

## Rollback

Revert the `lastLayout` field, command arg, and App restore/persist. Existing libraries without the field stay readable; libraries that already wrote `lastLayout` would fail old `deny_unknown_fields` (same class as `lastReaderMode`).
