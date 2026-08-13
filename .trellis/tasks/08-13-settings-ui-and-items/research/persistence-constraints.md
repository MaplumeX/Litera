# Persistence constraints for typography defaults and overrides

## preferences.json cannot grow by “just adding fields”

`src-tauri/src/preferences.rs`:

- `PreferencesData` is `deny_unknown_fields` and currently `{ schemaVersion, theme }`.
- `ensure_file` treats any parse failure, unknown schema, or invalid theme as “overwrite with defaults”. Overwrite sets `theme: light`.
- `save_theme` rewrites the **whole** file from a fresh `PreferencesData { schema_version, theme }`. Any new field dropped here is lost on the next theme change.

Implications:

- Keep `schema_version = 1`. Do not bump: a bump would look unsupported and wipe the user’s theme.
- New default fields (`lineHeight`, `pageMargin`, `textAlign`) must deserialize with `#[serde(default)]` so existing two-field files still load.
- `get_preferences` / `save_preferences` must become read-modify-write of the full record, not theme-only rewrite.
- `ensure_file` must accept a parsed v1 file that only has `theme`; missing typography keys take built-in defaults. Do not treat missing new keys as corrupt.

## update_reading_state replaces the whole settings object

`LibraryStore::update_reading_state` (`library.rs:736-738`) assigns `record.settings = Some(settings)`. It does not merge keys.

`validate_settings` currently requires at least one of `fontSize` / `fontFamily` / `theme`. New override-only payloads would fail that check unless the validator counts the new fields.

Implications:

- Frontend must send the **full intended per-book settings object** on every persist (existing font fields plus any overrides still in effect).
- “恢复默认” for one key means persist the object **without** that key, not send `{ lineHeight: null }` unless the Rust type uses `Option` and the command merges. Prefer omit-key + full remaining snapshot.
- Do not bump `library.json` `schemaVersion`. New keys are optional on `ReadingSettings`, same as `lastOpenedAt` / `contentHash`.

## Effective value

```
effective(field) = book.settings.field ?? preferences.field ?? builtin_default
```

Applies only to `lineHeight`, `pageMargin`, `textAlign`. Font size / family stay per-book with no global default. Theme stays global-only.
