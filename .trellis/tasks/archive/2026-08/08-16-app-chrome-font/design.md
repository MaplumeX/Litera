# Design: App chrome font and size

## Boundaries

- **In**: frontend only. New helper, settings appearance rows, apply to `document.documentElement`, i18n, tests, spec.
- **Out**: `src-tauri` `preferences.rs` / `save_preferences`, `ReadingSettings`, `generateStylesCss` inputs, reader iframe.

## Persistence

Follow locale / default-mode, not `preferences.json` (`deny_unknown_fields` would reset old builds).

| Key | Value | Default |
|---|---|---|
| `litera.uiFontSize` | integer string `12`–`20` | unset → 16 |
| `litera.uiFontFamily` | font name | unset → `Geist Variable` |

Module: `src/lib/ui-chrome-font.ts` (same shape as `src/lib/reader-mode.ts`).

```ts
export const UI_FONT_SIZE_KEY = "litera.uiFontSize";
export const UI_FONT_FAMILY_KEY = "litera.uiFontFamily";
export const DEFAULT_UI_FONT_SIZE = 16;
export const DEFAULT_UI_FONT_FAMILY = "Geist Variable";
export const UI_FONT_SIZE_RANGE = { min: 12, max: 20, step: 1 };

loadUiFontSize(): number
loadUiFontFamily(): string
saveUiFontSize(px: number): void
saveUiFontFamily(name: string): void
applyUiChrome(size: number, family: string): void
```

- Size: `Number.parse` → finite → clamp 12–20 → integer; else 16.
- Family: non-empty string; empty / missing → Geist. Reuse `is_valid_font_family` rules on the client if already exported (`isFontFamily` in `reader-styles`); invalid → Geist.
- `save*` swallow quota / private-mode errors (same as `saveDefaultReaderMode`).
- Do not use React context. Settings holds local state; the live effect is on `documentElement`.

## Applying to the DOM

`applyUiChrome(size, family)`:

1. `document.documentElement.style.fontSize = `${size}px``
2. `document.documentElement.style.setProperty("--font-sans", chromeFontStack(family))`

`chromeFontStack`:

- Geist / default: keep today's stack  
  `"Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif`
- Any other name: `cssFontFamily(name)` plus the same CJK / system fallbacks (skip duplicating the chosen name).

Call `applyUiChrome(loadUiFontSize(), loadUiFontFamily())` from `src/main.tsx` after `initLocale()`, before `createRoot`, so the first paint matches disk.

Settings onChange: update local state → `save*` → `applyUiChrome`. Live, no debounce required (slider already snaps to step 1).

Do not set `font-size` on `body` only. Tailwind `text-*` / `h-12` are rem against `html`.

## Settings UI

Appearance, below theme, above language:

- 「界面字体」: existing font combobox, with a leading Geist item (`value: "Geist Variable"`). `modal={false}` stays. Do not fork a second combobox module — add an optional leading item (or `includeGeist`) to the current picker.
- 「界面字号」: existing `Slider` + `formatTypographyValue`-style `Npx` readout. Range from `UI_FONT_SIZE_RANGE`, not `TYPOGRAPHY_RANGES.fontSize`.

New i18n keys (zh-CN / en, same `MessageKey` set): `settings.chrome.font`, `settings.chrome.fontSize`, `settings.font.geist`.

Do not reuse `settings.slider.fontSize` for the chrome row — that label lives under 排版.

## Isolation from the reader

- One `ReaderView`. Book CSS still comes only from `generateStylesCss(book styles)`.
- No new argument to `generateStylesCss`. Existing test that rejects `Geist` in that CSS stays meaningful.
- Parent `html` font-size does not pierce the chapter iframe.

## Compatibility / rollback

- Unset keys → current look (R4).
- Delete the two localStorage keys to roll back without touching `preferences.json`.
- Older app versions ignore the keys.

## Trade-offs

- Root rem scales geometry (`h-12` is no longer 48px). Accepted in D1.
- Full system font list includes poor UI faces. Accepted in D2.
- localStorage is not in `preferences.json` backups. Same as locale / default mode.
- Chinese default stays the system CJK stack. Do not add `@fontsource` Noto/Source Han. D6.
