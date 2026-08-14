# Implement: Replace sepia theme with system-following theme

## Checklist

1. **Backend — `src-tauri/src/preferences.rs`**
   - `VALID_THEMES` → `["light", "dark", "system"]`.
   - `From<PreferencesDataRaw>`: map `"sepia"` → `"light"` (migrate on read).
   - Update tests: `get_theme_returns_persisted_value` (sepia→system),
     `theme_only_file_loads_without_wiping_theme` (in-memory light, file keeps sepia),
     `old_enum_file_migrates_on_read_without_rewrite`, `save_partial_typography_does_not_drop_theme`,
     `named_font_family_is_not_treated_as_corrupt` (in-memory light, file keeps sepia).
2. **Backend — `src-tauri/src/library.rs`**: no change (VALID_THEMES keeps sepia for legacy per-book values).
3. **Frontend — `src/lib/reader-styles.ts`**: `THEMES` → light/dark/system; remove sepia from `THEME_CSS`.
4. **Frontend — `src/lib/preferences.ts`**: add `resolveTheme`; simplify `themeToClassName`.
5. **Frontend — `src/App.tsx`**: system-scheme state + listener; resolved theme for `<html>` class and reader CSS (both effects).
6. **Frontend — `src/components/settings/SettingsDialog.tsx`**: label keys system/sepia swap.
7. **i18n — `src/locales/zh-CN.ts` / `en.ts`**: remove sepia, add system.
8. **CSS — `src/index.css`**: remove `@custom-variant sepia` + `.sepia` block.
9. **Types — `src/types/library.ts`**: update theme comment.
10. **Tests — `src/lib/reader-styles.test.ts`**: replace sepia fixtures.

## Validation

- `cargo test` (in `src-tauri/`) — all pass.
- Frontend test command (check `package.json`) — all pass.
- `npm run build` (or `tsc --noEmit`) — no type errors.
- Manual: settings shows 白天/夜间/跟随系统; toggling system + OS theme flips app and reader live.

## Review gates

- After step 1: `cargo test` green.
- After steps 3–9: frontend tests + typecheck green.
- Final: full-scope check (grep for `sepia` in `src/` — only legacy-acceptance
  references in Rust `library.rs` and test fixtures may remain).

## Rollback

- Revert commit; old `"sepia"` values were never rewritten by this change
  (migrate-on-read only), so rollback is lossless.
