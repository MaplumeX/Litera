# Book font / layout override — CSS and persistence

## Why user settings lose today

`generateStylesCss` (`src/lib/reader-styles.ts`) injects:

```
html, body { font-family; font-size !important; line-height; letter-spacing; max-width; padding-inline; text-align }
p { margin-block-end !important; text-indent !important }
```

EPUB chapter CSS commonly sets `p, span, div, .calibre { font-family: "EmbeddedFace" }` and ships `@font-face`. Those rules are more specific than `html, body` without `!important`, so the user font does not show.

`font-size !important` on `html, body` does not win against `p { font-size: 14px }` because `!important` does not inherit. Paragraph spacing/indent already win on `p` only.

foliate `setStyles` replaces one user stylesheet and reapplies it on each section load. It does not disable publisher stylesheets. Do not patch `src/foliate-js`.

## CSS strategy (chosen)

Do not strip publisher stylesheets. Strengthen the user stylesheet when a flag is on.

**Override font on**

```
html, body, p, div, span, li, blockquote, td, th, a, h1, h2, h3, h4, h5, h6 {
  font-family: <user> !important;
}
code, kbd, pre, samp { font-family: monospace !important; }
```

`@font-face` cannot be unregistered from a later stylesheet. Forcing `font-family` with `!important` makes the embedded faces unused. That matches R2.

**Override layout on**

Apply `font-size`, `line-height`, `letter-spacing`, `text-align` with `!important` to body-text elements (`html, body, p, div, li, blockquote`), **not** `h1–h6`. Keep `p { margin-block-end; text-indent }` with `!important` (already present) and extend to `li` if tests show lists ignore `p` rules. Do not set `font-size` on headings.

**Both off**

Emit today's CSS unchanged (R4.1). Do not remove the existing `font-size !important` on `html, body` or the `p` indent/spacing `!important`.

**Always**

`max-width` / `padding-inline` on `html, body` stay as they are (R3.3).

**Footnotes**

Footnote inner view already concatenates `generateStylesCss` + `footnotePopupCss()`. If `generateStylesCss` reads the flags from `ReaderStyleState`, footnotes follow automatically. Do not special-case.

**Preview**

`generatePreviewCss` has no publisher CSS. Leave it as typography-only preview (R6.2).

## Persistence

Same channel as other reader typography, not `localStorage`.

| Store | Type | Missing |
| --- | --- | --- |
| `preferences.json` | `bool`, default `false` | treat as off |
| `ReadingSettings` | `Option<bool>`, skip if none | fall back to preferences |

Effective value: book override ?? preferences ?? `false`.

`false` on a book is a real override (global on, this book off). `isTypographyOverridden` must use `!= null`, not truthiness.

`schemaVersion` stays 1. `#[serde(default)]` on both structs. `ReadingSettings::is_empty` and `validate_settings` must know the new keys. `save_preferences` already has `too_many_arguments`; add two `Option<bool>` the same way, do not introduce a new command.

Old builds + new keys: `deny_unknown_fields` will reset `preferences.json`. Same constraint as `letterSpacing` / `firstLineIndent`. Do not invent a sidecar file.

## UI

No `Switch` in `src/components/ui/`. Use existing `SegmentedControl` (关 / 开) inside `PresetRow`, same as theme/align. Place both rows in Settings → Typography after `TypographyPreview`.

`onTypographyChange` today is `(key, number | string)`. Extend the value union to `boolean` for these two keys, or the snapshot helper cannot reuse `handleTypographyChange`.

## Files that must stay in sync

- `src/types/library.ts` `ReadingSettings`
- `src-tauri/src/library.rs` `ReadingSettings` + `validate_settings` + `is_empty`
- `src-tauri/src/preferences.rs` raw/data/response/patch/`save_preferences`
- `src/lib/preferences.ts` invoke payload + `PreferencesResponse`
- `src/lib/reader-styles.ts` keys, normalize, snapshot, CSS
- `src/components/settings/SettingsDialog.tsx` + i18n catalogs
- Tests: `reader-styles.test.ts`, Settings dialog, Rust library/preferences
