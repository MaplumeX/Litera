# Implement: settings page and typography items

## Checklist

1. **Preferences store**
   - Extend `PreferencesData` / `PreferencesResponse` with defaulted `lineHeight`, `pageMargin`, `textAlign`.
   - Change `save_theme` / `save_preferences` to read-modify-write.
   - Keep `schema_version = 1`; do not wipe a valid theme-only file.
   - Validate enums; add Rust tests: old file loads, theme preserved, merge does not drop sibling keys, invalid enum rejected.

2. **ReadingSettings**
   - Add the three optional fields in Rust + `src/types/library.ts`.
   - Extend `validate_settings` allow-lists and “at least one field”.
   - Tests: persist override, persist snapshot without a key (restore), reject unknown enum, old `{fontSize,fontFamily}` still valid.

3. **Style pipeline**
   - Extend `ReaderStyleState`, `normalizeSettings`, `generateStylesCss` with presets from `design.md`.
   - Effective value = book override ?? preferences ?? builtin.
   - Update `App` persist: reader writes full per-book snapshot; library writes preferences; theme still global.

4. **Settings page**
   - Add `SettingsPage` (left nav 排版/外观/AI).
   - `App` view `"settings"` + `settingsReturnTo`.
   - Wire library gear and reader Aa to the page; remove `SettingsDialog` mounts.
   - Restore-default only on reader-entered page when that key is present on the book.
   - Show editing-book vs editing-defaults copy.

5. **AI form reuse**
   - Extract `AgentConfigForm` from `AgentConfigDialog`.
   - Dialog wraps the form; settings AI section renders the form.
   - `ChatPanel` still opens the dialog only.

6. **Tests / docs in code**
   - Frontend tests for normalize / CSS generation / effective merge if there is an existing style test home; otherwise add focused unit tests next to `reader-styles.ts`.
   - Update any `SettingsDialog` tests to the page, or add a thin `SettingsPage` test for nav + disabled fonts without a book.

## Validation

```bash
cd sidecar && npm test
cd .. && npm test && npm run build
cd src-tauri && cargo test
```

Minimum: preferences + library settings tests, `npm test`, `npm run build`.

## Risky files / rollback points

| File | Risk |
|---|---|
| `src-tauri/src/preferences.rs` | Theme wipe if `ensure_file` or save rewrite is wrong |
| `src-tauri/src/library.rs` | `update_reading_state` replace semantics drop fonts if snapshot is partial |
| `src/App.tsx` | Settings back accidentally calls `handleBackToLibrary` |
| `src/components/chat/ChatPanel.tsx` | Do not add `onOpenSettings` |

If preferences tests fail on “old file → theme reset”, stop and fix store before touching UI.

## Before `task.py start`

- [x] `prd.md` converged
- [x] `design.md` / `implement.md` present
- [x] research notes in `research/`
- [x] `implement.jsonl` / `check.jsonl` have real spec/research entries
- [ ] User approved this planning summary
