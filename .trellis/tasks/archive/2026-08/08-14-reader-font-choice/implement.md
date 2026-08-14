# Implement: reader system font choice

## Checklist

1. Extract `is_valid_font_family` in `library.rs`. Replace both `VALID_FONT_FAMILIES` closed checks (library settings + preferences patch + `is_supported`).
2. Add Rust tests: named font saves; `;` / empty / overlong rejected; `preferences.json` with a named font is not overwritten on `ensure_file`; old three generics still load.
3. Add `font-kit` dependency. Implement `list_system_fonts` with `spawn_blocking`. Register in `lib.rs`.
4. Frontend: shared `isFontFamily` / quote helper in `reader-styles.ts`. `generateStylesCss` quotes named fonts and appends `, serif`. Update `reader-styles.test.ts`.
5. `normalizePreferences` must keep a valid named font (stop dropping anything outside the old three).
6. Add shadcn `popover` + `command`. Replace font `ChoiceButton`s in `SettingsDialog` with a searchable combobox. i18n keys for search placeholder + unavailable. Load `list_system_fonts` when the typography section is shown.
7. Settings tests: combobox renders generics; choosing a name calls `onTypographyChange`; missing current value shows unavailable; dialog size classes unchanged.
8. Run `npm test`, `npm run build`, and the Rust preference/library tests.

## Validation

```bash
npm test
npm run build
cd src-tauri && cargo test preferences library -- --test-threads=1
```

Manual: open settings from library and from a book, search a CJK family, confirm the page reflows, restore default, quit and reopen.

## Risky files

- `src-tauri/src/preferences.rs` — `is_supported` / `ensure_file` can wipe theme if the validator is wrong
- `src/lib/reader-styles.ts` — unquoted names break CSS
- `src/components/settings/SettingsDialog.tsx` — combobox inside `Dialog` focus trap; keep popover modal={false} or equivalent if focus locks

## Rollback

`git checkout` the files in this checklist. If a named font was already written, set `fontFamily` back to `serif` before running an older binary.
