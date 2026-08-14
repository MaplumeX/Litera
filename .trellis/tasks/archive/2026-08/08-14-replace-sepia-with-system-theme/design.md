# Design: Replace sepia theme with system-following theme

## Overview

Theme options change from `light / dark / sepia` to `light / dark / system`.
`system` resolves at runtime to the OS `prefers-color-scheme` and follows OS
changes live. Sepia is removed entirely (CSS, reader injection, i18n).

## Data model

- Global preference `theme` accepts `"light" | "dark" | "system"`.
- Per-book `ReadingSettings.theme` stays deprecated: never written by the
  frontend, only accepted for old files (validation keeps accepting legacy
  values).

## Backend (Rust)

### `src-tauri/src/preferences.rs`

- `VALID_THEMES` → `["light", "dark", "system"]`.
- **Migration on read**: in `From<PreferencesDataRaw> for PreferencesData`,
  map `"sepia"` → `"light"`. This keeps in-memory data always valid so
  `is_supported()` never triggers the whole-file reset for legacy sepia files.
  The on-disk file keeps `"sepia"` until the next write (which then persists
  `"light"`), matching the existing "migrate on read without rewrite" pattern.
- `validate_patch` rejects `"sepia"` on write (frontend never sends it).
- Tests: `save_theme("sepia")` → `"system"`; legacy-file tests assert in-memory
  theme becomes `"light"` while the file keeps `"sepia"`.

### `src-tauri/src/library.rs`

- `VALID_THEMES` keeps `["light", "dark", "sepia"]` (defensive validation for
  legacy per-book values; frontend never writes `theme` anymore). No change
  needed; existing tests keep passing.

## Frontend (TS)

### `src/lib/reader-styles.ts`

- `THEMES` → `["light", "dark", "system"] as const`.
- `THEME_CSS`: remove the `sepia` entry. `system` never reaches
  `generateStylesCss` — the caller resolves it first.

### `src/lib/preferences.ts`

- `normalizePreferences`: unchanged (THEMES check now includes `system`).
- New `resolveTheme(theme: string): "light" | "dark"`:
  `theme === "system"` → `window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"`;
  otherwise `theme === "dark" ? "dark" : "light"`.
- `themeToClassName`: simplify to `theme === "dark" ? "dark" : ""` (only
  light/dark reach it after resolution).

### `src/App.tsx`

- Track OS scheme: `useState(() => matchMedia("(prefers-color-scheme: dark)").matches)`
  + `change` listener (addEventListener/removeEventListener).
- `resolvedTheme = resolveTheme(globalTheme, systemDark)` (memoized).
- `<html>` class effect: remove only `"dark"`, add `"dark"` when
  `resolvedTheme === "dark"`.
- Reader CSS: `generateStylesCss({ ...styleState, theme: resolvedTheme })` in
  both the style effect and `handleBookReady` (styleStateRef must hold the
  resolved theme).

### `src/components/settings/SettingsDialog.tsx`

- `THEME_LABEL_KEYS` gains `system: "settings.theme.system"`; drop `sepia`.

### i18n

- `zh-CN.ts`: remove `settings.theme.sepia`, add `settings.theme.system: "跟随系统"`.
- `en.ts`: remove `settings.theme.sepia`, add `settings.theme.system: "System"`.

### `src/index.css`

- Remove `@custom-variant sepia` and the whole `.sepia { ... }` block.

### `src/types/library.ts`

- Update the `theme` comment (no longer mentions sepia as a written value).

## Tests

- `src/lib/reader-styles.test.ts`: replace `sepia` fixtures with `system`
  (theme is not emitted by `bookSettingsSnapshot`; `generateStylesCss` tests
  use light/dark only).
- Rust: update preferences tests per migration behavior above.
- `cargo test` + `npm run test` (or the project's frontend test command) must
  pass.

## Out of scope

- Per-book theme re-activation.
- Window chrome theming via Tauri (app already follows via CSS classes).
