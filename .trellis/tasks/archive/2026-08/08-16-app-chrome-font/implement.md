# Implement: App chrome font and size

## Checklist

1. **Helper** — add `src/lib/ui-chrome-font.ts` + `src/lib/ui-chrome-font.test.ts`: load/save/parse/clamp, `chromeFontStack`, `applyUiChrome` (jsdom: assert `documentElement` font-size and `--font-sans`). Invalid / missing → 16 + Geist. Do not write `preferences.json`.
2. **Boot** — `src/main.tsx`: after `initLocale()`, call `applyUiChrome(loadUiFontSize(), loadUiFontFamily())`.
3. **Picker** — extend the existing Settings font combobox so chrome can prepend Geist. Do not copy the component. Reader typography path still starts with the three generics (no Geist in 排版, or Geist only when the chrome flag is on).
4. **Appearance rows** — `SettingsDialog` 外观：主题下加界面字体 + 界面字号。Local state like `defaultReaderMode`. onChange → save + apply.
5. **i18n** — `settings.chrome.font`, `settings.chrome.fontSize`, `settings.font.geist` in zh-CN and en. Catalog key parity test must stay green.
6. **Tests** — `SettingsDialog.test.tsx`: appearance shows the two rows; changing them updates `documentElement`; typography section still does not apply chrome. Keep `generateStylesCss` Geist-rejection. Do not remount `ReaderView` in these tests.
7. **Spec** — Phase 3.3: chrome type is user-overridable; persist localStorage not `preferences.json`; Geist remains the default stack.

## Validation

```bash
npm test -- --run
npm run build
```

No separate lint script.

## Risky files / rollback

- `src/index.css` `@theme --font-sans`: prefer overriding the property on `html`, do not delete the default token.
- `SettingsDialog.tsx` font picker: a careless shared change can put Geist into the 排版 list or break `modal={false}`.
- Do not add fields to `src-tauri/src/preferences.rs`.

Rollback: revert the frontend files; users can clear `litera.uiFontSize` / `litera.uiFontFamily`.

## Ready for start

- [x] PRD decisions D1–D6 closed
- [x] design.md + implement.md
- [x] implement.jsonl / check.jsonl curated
