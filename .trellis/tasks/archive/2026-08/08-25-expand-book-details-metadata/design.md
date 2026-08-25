# Design: expand book details metadata

## Boundaries

- **WebView**: details dialog UX; import-time extraction via existing `extractEpubMetadata`; i18n.
- **Rust**: persist four optional strings on `BookRecord`; accept them on `save_book_metadata` and `update_book_metadata`.
- **Not in scope**: rewriting EPUB bytes (app copy or original file), `bookId`, Agent `get_book_metadata`, shelf cards/search, backfill of already-imported books. Write-back was considered and rejected; readers in this class keep metadata on the shelf (`research/reader-metadata-writeback.md`).

## Data contract

`BookRecord` gains four optional camelCase fields. `schemaVersion` stays 1. Missing keys on old `library.json` must load.

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub description: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub publisher: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub language: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub series: Option<String>,
```

Same shape on the TypeScript `BookRecord`.

Empty / whitespace-only values persist as omitted keys (`None`), not `""`. Frontend treats missing as `""` in the form.

Caps (UTF-8 bytes), allow empty:

| Field | Max |
| --- | --- |
| publisher / language / series | 4 KiB (`MAX_AUTHOR_BYTES`) |
| description | 32 KiB |

Validate on `save_book_metadata`, `update_book_metadata`, and `validate_library_records`. Over-cap is `InvalidInput` for commands; stored over-cap is `StorageCorrupt`.

Commands stay flat, matching today's invoke style:

```ts
await invoke<BookRecord>("update_book_metadata", {
  bookId, title, author,
  description, publisher, language, series,
  coverBytes?: number[],
});

await invoke<BookRecord>("save_book_metadata", {
  bookId, title, author,
  description, publisher, language, series,
  coverBytes, importId,
});
```

Always send the four strings from the dialog / import commit (empty string allowed). Do not add a nested patch object.

`update_book_metadata` still must not change `id`, `filePath`, `importedAt`, `contentHash`, `contentVersion`, `lastFraction`, `lastCfi`, `settings`, `lastOpenedAt`, `lastReaderMode`, `lastLayout`, or EPUB bytes. Cover omit/keep/replace rules unchanged.

Staging `BookRecord` in `import_bytes` sets the four fields to `None` until `save_book_metadata`.

## Data flow

```
New/overwrite import
  staged EPUB bytes
  → extractEpubMetadata (foliate + normalize)
  → save_book_metadata (library.json)
  → details / list_books read BookRecord

Details save
  form strings
  → update_book_metadata
  → library.json only

Old books
  missing keys → empty form; no extract on open
```

## Extraction

Extend `extractEpubMetadata` in `src/lib/book-utils.ts`. Mapping: `research/epub-prefill-fields.md`.

- Reuse `extractFirstValue`.
- Language: string or `", "`-joined array.
- Series: `belongsTo.series` name; if `position` is a finite number, one string `"{name} · {position}"`.
- Description: strip tags, collapse whitespace.
- Truncate to the same byte caps before invoke so a huge `dc:description` cannot fail import.
- Extraction failure of these four fields must not fail import: treat as empty. Title/author/cover behavior stays as today.

`src/foliate-js.d.ts` `Book.metadata` should include `description`, `publisher`, `language`, `belongsTo` so extract is typed.

## Dialog

`BookDetailsDialog`:

- `onOpenAutoFocus={(event) => event.preventDefault()}` on `DialogContent`. Do not `autoFocus` the title input. Do not `select()`.
- Bind the four new fields. Description uses existing `src/components/ui/textarea.tsx`. Publisher / language / series use `Input`.
- Prefill from `book.description ?? ""` etc. when `open` + `book` change (same effect as title/author).
- Save sends all four strings with title/author. Cancel/close does not invoke.
- Keep progress + imported time read-only.
- Add zh-CN / en keys. Update `library.detailsDescription`.

Cards, list rows, continue-reading, and search stay title/author/cover only.

## Compatibility

- Old `library.json` without the four keys remains valid (`serde(default)`).
- New writes omit empty keys (`skip_serializing_if`).
- Unknown extra keys still `StorageCorrupt` (`deny_unknown_fields`).
- No `preferences.json` keys. No `localStorage` keys.

## Trade-offs

- Optional omitted keys vs always-empty strings: omit matches `lastOpenedAt` and keeps old files quiet.
- Flat command args vs a metadata struct: keep flat; both sides are in-repo and tests already pass discrete strings.
- No old-book backfill: empty until hand-edit or overwrite import, per PRD.
- No EPUB write-back: same as KOReader / Foliate / Thorium / Readest; Agent OPF reads stay the file originals.

## Rollback

Revert the dialog, extract, TS types, and the two command signatures. Old libraries without the new keys still load. Libraries that already wrote the new keys would fail `deny_unknown_fields` on a reverted binary — acceptable for a desktop app that ships frontend+Rust together; do not bump `schemaVersion`.
