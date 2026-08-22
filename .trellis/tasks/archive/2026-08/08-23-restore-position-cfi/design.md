# Design: restore reading position via CFI

## Approach

Follow the `lastFraction` / `lastReaderMode` shelf pattern. Add optional `lastCfi` on `BookRecord` and `BookOpenContext`. Persist it through `update_reading_state` as a fifth independent `Option`. Restore by passing the CFI into foliate `init({ lastLocation })` instead of `init({})` then `goToFraction`.

Do **not** put the locator on `ReadingSettings`, `annotations.json`, or `localStorage`. Do **not** bump `library.json` `schemaVersion`. Keep `lastFraction` as the percent field.

## Why not fix `goToFraction` rounding

`lastFraction` is a progress-display number (end of the current page / book). Using it as a page index is the bug. CFI is already the locator for bookmarks, highlights, TTS, and foliate history. Reuse it.

## Contract

```ts
interface BookRecord {
  // existing fields…
  lastFraction?: number;
  lastCfi?: string; // missing = no locator; do not put on settings
}

interface BookOpenContext {
  // existing fields…
  lastFraction?: number;
  lastCfi?: string;
}
```

Rust: `last_cfi: Option<String>` with `rename = "lastCfi"`, `default`, `skip_serializing_if = "Option::is_none"`.

```rust
async fn update_reading_state(
    book_id: String,
    last_fraction: Option<f64>,
    settings: Option<ReadingSettings>,
    last_reader_mode: Option<String>,
    last_layout: Option<ReaderLayout>,
    last_cfi: Option<String>,
) -> AppResult<()>
```

At least one of the five `Option`s must be `Some`. `Some(last_cfi)` replaces only that field.

Relocate writes **both** `lastFraction` and `lastCfi` in one invoke so `library.json` is not written twice. Settings / mode / layout invokes omit `lastCfi`.

### Validation

Reuse `validate_cfi` (non-empty, ≤ `MAX_CFI_BYTES` 8 KiB, starts with `epubcfi(`, reject `foliate-search:`).

| Stored / written value | Result |
|---|---|
| field missing | valid |
| `epubcfi(...)` within cap | valid |
| empty, too long, not `epubcfi(`, `foliate-search:` | write: `InvalidInput`; load: `StorageCorrupt` |

Missing field on old `library.json` is valid. Present-but-invalid is `StorageCorrupt`, same as bad `lastFraction`.

Old builds that see `lastCfi` fail `deny_unknown_fields` — accepted, identical to adding `lastLayout`.

Overwrite/reimport keeps the existing `BookRecord`, so `lastCfi` is retained automatically. Map it through `get_book_open_context`.

## Frontend flow

```
relocate
  lastLocation.cfi + lastLocation.fraction
  do not set currentBook.lastCfi / lastFraction
  debounce 500ms → update_reading_state({ lastFraction, lastCfi })

open book
  get_book_open_context
  pass initialCfi + initialFraction into ReaderView (open-time snapshot only)

ReaderView open effect
  if initialCfi:
    init({ lastLocation: initialCfi })   // do not init() then goTo — init() calls next()
  else:
    init({})
    if initialFraction > 0: goToFraction(initialFraction)
  onBookReady → setStyles (existing). CFI restore leaves a Range/#anchor; reflow stays on the text.

CFI init / goTo throws or resolve fails
  goToFraction(initialFraction) if present, else leave at start
```

`ReaderView` already exposes `getLocation()` and `goToCfi`. Add `initialCfi?: string`. Keep the “do not write locator into `currentBook` on relocate” rule (`App.tsx` ~218) so `[fileData, initialFraction, initialCfi]` does not re-open.

CFI for persist: `handleRelocate` in `ReaderView` writes `lastLocationRef` before `onRelocate`. App can read `readerRef.getLocation()?.cfi` or pass `cfi` on the callback. One invoke with both fields.

## Compatibility / rollback

- Existing books: only `lastFraction` → POS-4 path, no migration.
- After one relocate on a new build, `lastCfi` is present.
- Removing the field later: unset records stay clean (`skip_serializing_if`); records that already wrote `lastCfi` would fail old `deny_unknown_fields`.

## Trade-off

Shelf CFI vs `annotations.json`: position is shelf state like `lastFraction`, not a user mark. Putting it on the bookmark file would mix auto-updated location with explicit pins and still need a `BookOpenContext` field to restore before annotations load.
