# Implement: Override book fonts and typography

## Checklist

1. **Types + normalize**
   - Add `overrideFont` / `overrideLayout` to `TypographyKey`, `TYPOGRAPHY_KEYS`, `TypographyDefaults` / `DEFAULT_TYPOGRAPHY` (`false`), `ReaderStyleState`.
   - `normalizeSettings` resolves `settings ?? preferences ?? false`.
   - `materializeOverrides` / `isTypographyOverridden` / `bookSettingsSnapshot` treat `false` as present.
   - `onTypographyChange` value union includes `boolean`.

2. **CSS**
   - `generateStylesCss`: flags false → identical to current output.
   - Font on → `!important` family on body-text + headings; `code, kbd, pre, samp` stay `monospace`.
   - Layout on → `!important` size/line-height/letter-spacing/align on body-text, not `h1–h6`; keep `p` indent/spacing.
   - `generatePreviewCss` unchanged regarding publisher CSS.
   - Tests in `reader-styles.test.ts` for off/on/font-only/layout-only, named font quoting, no Geist.

3. **Backend persistence**
   - `ReadingSettings` in `library.rs`: optional bools, `is_empty`, no extra validation.
   - `preferences.rs`: raw/data/response/patch/`save_preferences`/`From` impls. Default false. Theme-only file still loads.
   - Rust tests: persist true; missing keys load as false; book `false` is not dropped; empty snapshot still clears.

4. **Frontend persistence**
   - `src/types/library.ts`
   - `src/lib/preferences.ts` response + save invoke
   - `App.tsx` `handleTypographyChange` accepts boolean

5. **Settings UI + i18n**
   - Two `PresetRow` + `SegmentedControl` after preview in `SettingsDialog`.
   - Restore-default when the book snapshot has the key.
   - Keys in `zh-CN.ts` / `en.ts`; catalog parity test already exists.
   - `SettingsDialog.test.tsx`: both controls present; toggling calls `onTypographyChange`; restore visible when overridden.

6. **Validation**
   - `npm test`
   - `npm run build`
   - `cargo test` in `src-tauri` (preferences + library reading-settings tests)

## Validation commands

```bash
npm test -- src/lib/reader-styles.test.ts src/components/settings/SettingsDialog.test.tsx src/lib/preferences.ts src/lib/i18n.test.ts
npm run build
cd src-tauri && cargo test preferences -- --nocapture
cd src-tauri && cargo test reading_settings -- --nocapture
```

## Risky files

- `src/lib/reader-styles.ts` — wrong selectors flatten headings or restyle `code`.
- `src-tauri/src/preferences.rs` — miss a struct in the persist chain; theme-only file fails `deny_unknown_fields` or `is_supported`.
- `src/App.tsx` `handleTypographyChange` — boolean discarded by `number | string` typing.

## Rollback

Flags default off. Revert `generateStylesCss` first if a book is unreadable; persistence keys can remain unread.

## Ready for `task.py start`

- [x] PRD decisions closed
- [x] `design.md`
- [x] this checklist
- [x] `implement.jsonl` / `check.jsonl` curated (Phase 1.3)
