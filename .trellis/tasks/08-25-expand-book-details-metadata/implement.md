# Implement: expand book details metadata

## Checklist

1. **Rust `BookRecord`**
   - Add `description` / `publisher` / `language` / `series` as `Option<String>` with `serde(default, skip_serializing_if = "Option::is_none")` and camelCase names.
   - Cap description at 32 KiB; other three at 4 KiB. Empty → `None`.
   - Set `None` on the staging record in `import_bytes`.
   - Validate on `save_book_metadata`, `update_book_metadata`, and `validate_library_records`.

2. **Rust commands**
   - Add the four string args to `save_book_metadata` and `update_book_metadata` (store method + `#[tauri::command]`).
   - Persist them. Cover / EPUB / progress contracts unchanged.
   - Update `import_test_book` and every existing `save_book_metadata` / `update_book_metadata` test call.
   - Add tests: persist + round-trip; empty omits keys; old JSON without keys still loads; title-only-style update keeps cover/progress/EPUB/`contentHash`; over-cap rejected; overwrite path replaces the four fields.

3. **Extract**
   - Extend `ExtractedMetadata` and `extractEpubMetadata`.
   - Normalize per `research/epub-prefill-fields.md`. Truncate to caps.
   - Update `src/foliate-js.d.ts`.
   - Unit-test the pure helpers (first value, HTML strip, language join, series string, truncate). Mock `extractEpubMetadata` call sites already exist in `book-import.test.ts` and `LibraryView.test.tsx` — extend those mocks.

4. **Import commit**
   - `commitStagedImport` passes the four extracted strings into `save_book_metadata`.
   - `book-import.test.ts`: new import sends them; duplicate still does not save.

5. **Details dialog**
   - `onOpenAutoFocus` preventDefault on `DialogContent`.
   - Four fields + textarea for description. i18n zh-CN / en.
   - Save payload includes the four strings.
   - `LibraryView.test.tsx`: save with extra fields; empty extra fields allowed; cancel does not save; opening details does not leave the title input focused/selected.

6. **Frontend types**
   - Optional fields on `BookRecord` in `src/types/library.ts`. Any test fixtures that construct records keep compiling (fields optional).

## Validation

```bash
npx tsc --noEmit
npx vitest run src/lib/book-utils.test.ts src/lib/book-import.test.ts src/components/LibraryView.test.tsx
cd src-tauri && cargo test --lib library::
```

If project lint is configured, run the same frontend lint used in recent tasks.

## Risky files

- `src-tauri/src/library.rs` — `BookRecord` literals and many metadata tests.
- `src/components/BookDetailsDialog.tsx` — focus + form.
- `src/lib/book-utils.ts` — foliate metadata shape is loose; keep extract resilient.

## Rollback points

- After Rust schema/command change, old UI cannot save until the dialog/import catch up — land both sides in one commit.
- Extraction bugs: fall back to empty extra fields; do not block title/author/cover commit.

## Follow-up before `task.py start`

- `implement.jsonl` / `check.jsonl` have real spec + research entries.
- User has approved this planning summary.
