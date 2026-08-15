# Persistence for reader / Agent mode

## Why not preferences.json for the app default

`PreferencesDataRaw` uses `deny_unknown_fields` (`src-tauri/src/preferences.rs`). Frontend spec `i18n.md` already rejected putting `locale` there: older builds treat unknown keys as corrupt and reset theme/typography.

App default mode is the same class of UI chrome as locale. Persist to `localStorage` key `litera.defaultReaderMode` (`reader` | `agent`). Unset or invalid → `reader`.

Surface it in Settings → Appearance next to theme/language. Do not add a field to `save_preferences`.

## Per-book last mode belongs on BookRecord

`lastFraction` / `lastOpenedAt` are optional shelf fields on `BookRecord` with `#[serde(default)]` and no `schemaVersion` bump (`database-guidelines.md`). Last reader mode is the same kind of durable per-book state.

Add optional `lastReaderMode`: `"reader" | "agent"`.

- Missing on old records is valid.
- Present-but-invalid is `StorageCorrupt` (same as other optional shelf fields).
- `BookOpenContext` must return it so open-book can resolve mode without a second round trip.
- Extend `update_reading_state` with an independent `Option` (like fraction vs settings). At least one of `{ lastFraction, settings, lastReaderMode }` is required.

Do not store per-book mode in `ReadingSettings`. That object is a full-replace typography snapshot.

## Layout chrome

Follow `toc-sidebar-width.ts`:

- Agent book pane width → `localStorage` (suggested key `litera.agent-book-width`), percent, clamp to a sane min/max.
- Reader-mode chat width stays on existing `useDefaultLayout({ id: "reader-chat" })` if the unified shell can keep that id; otherwise migrate to an explicit `litera.chat-panel-width` helper and do not lose the saved 22% default.
- Session list width is fixed (~240px). Do not persist a drag width.
- Session-list / book collapsed flags are process-only, like `chatCollapsed` and `tocVisible`. Re-entering Agent mode opens both.

## Cross-layer contract

Rust and TS field names stay camelCase on the wire (`lastReaderMode`).

Today's command (must stay backward compatible for callers that only send fraction/settings):

```text
update_reading_state(book_id, last_fraction?, settings?)
get_book_open_context → BookOpenContext { lastFraction?, settings?, ... }
```

After this task:

```text
update_reading_state(book_id, last_fraction?, settings?, last_reader_mode?)
  — at least one of the three Options is required
  — last_reader_mode is "reader" | "agent" or omitted
BookOpenContext.lastReaderMode?: "reader" | "agent"
BookRecord.lastReaderMode?: "reader" | "agent"
```

Overwrite import must keep `lastFraction`, `settings`, `lastOpenedAt`, and the new `lastReaderMode`. Do not put mode on `ReadingSettings` (full-replace typography snapshot).
