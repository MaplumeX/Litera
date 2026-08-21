# Design: per-book reader layout persistence

## Approach

Follow the existing `lastReaderMode` shelf pattern. Store one optional `lastLayout` snapshot on `BookRecord` / `BookOpenContext`. Update it through `update_reading_state` as a fourth independent `Option`, same gate as fraction / settings / mode.

Do **not** put layout on `ReadingSettings` or in `localStorage`. Do **not** bump `library.json` `schemaVersion`.

## Contract

```ts
interface ReaderLayout {
  chatCollapsed: boolean;
  bookCollapsed: boolean;
  sessionRailOpen: boolean;
}

interface BookRecord {
  // existing fields…
  lastLayout?: ReaderLayout; // missing = no memory
}

interface BookOpenContext {
  // existing fields…
  lastLayout?: ReaderLayout;
}
```

Rust mirrors this as `ReaderLayout` with `rename_all = "camelCase"` and `deny_unknown_fields`. `BookRecord.last_layout` uses `default` + `skip_serializing_if = "Option::is_none"`. When the object is present, all three bools are required.

```rust
async fn update_reading_state(
    book_id: String,
    last_fraction: Option<f64>,
    settings: Option<ReadingSettings>,
    last_reader_mode: Option<String>,
    last_layout: Option<ReaderLayout>,
) -> AppResult<()>
```

At least one of the four `Option`s must be `Some`. A `Some(last_layout)` **replaces** the whole snapshot (like `settings`). It must not clear fraction, settings, or mode.

### Validation

| Stored / written value | Result |
|---|---|
| field missing | valid; frontend uses defaults |
| `{ chatCollapsed, bookCollapsed, sessionRailOpen }` all bools | valid |
| non-object, extra keys, missing key, non-bool | write: `InvalidInput`; load: `StorageCorrupt` |

Same strict-read rule as `lastReaderMode`. Old builds that hit a library file containing `lastLayout` will fail `deny_unknown_fields` — accepted, identical to adding `lastReaderMode`.

Overwrite/reimport keeps the existing `BookRecord`, so `lastLayout` is retained automatically.

## Frontend flow

```
open book
  get_book_open_context
  set flags from context.lastLayout ?? defaults
  (do not hard-reset the three flags)

toggle chat / book / session rail
  (also: selection auto-opens chat; TOC/annotations may expand book)
  debounce 500ms → update_reading_state({ lastLayout })

switch Reader ↔ Agent
  persist mode only; do not touch the three flags

back to library / close window / open another book
  flush layout with the other reading-state writers
```

Defaults (LAY-4): `{ chatCollapsed: true, bookCollapsed: false, sessionRailOpen: true }`.

Small helper next to `src/lib/reader-mode.ts` (`src/lib/reader-layout.ts`) for the type, defaults, and `resolveReaderLayout`. App state stays in `App.tsx`; no new store.

Remove the Agent-entry reset in `handleReaderModeChange`. Keep the TOC/annotations `setBookCollapsed(false)` when opening those drawers.

Process reset on `handleBackToLibrary` (no book open) can still clear the React state; the next open restores from disk.

## Compatibility / rollback

- Missing `lastLayout` on existing books: first-open defaults. No migration.
- Removing the field later: `skip_serializing_if` means unset records stay clean; records that already wrote `lastLayout` would need an old-build bump or a follow-up strip — out of scope.

## Trade-off

Nested snapshot vs three sibling `lastChatCollapsed` fields: nested matches `settings` (one replaceable object, always written together) and keeps `update_reading_state` to one extra argument instead of three.
