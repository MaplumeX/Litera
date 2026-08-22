# Design: Override book fonts and typography

## Boundaries

- **In**: reader stylesheet (`generateStylesCss`), settings typography UI, `ReadingSettings` + `preferences.json` persistence, i18n.
- **Out**: foliate-js submodule, publisher stylesheet stripping, Appearance chrome fonts, theme colors, preview simulating publisher CSS.

## Data

Two flags on the existing typography snapshot:

| Key | JSON | Default |
| --- | --- | --- |
| `overrideFont` | bool | `false` |
| `overrideLayout` | bool | `false` |

Effective value: `book.settings.overrideX ?? preferences.overrideX ?? false`.

Per-book `Option<bool>`:

- omitted → follow global
- `true` / `false` → book override (`false` is valid: global on, this book off)
- restore default → omit the key (`bookSettingsSnapshot(..., omit)`)

Do not bump `schemaVersion`. `serde(default)` on Rust read paths. `ReadingSettings` already `deny_unknown_fields`; add the fields as optional with `skip_serializing_if = "Option::is_none"`.

## Data flow

```
Settings segmented 开/关
  → handleTypographyChange(key, boolean)
  → reader: bookSettingsSnapshot + update_reading_state (full settings object)
  → library: updatePreferences + save_preferences patch
  → styleState via normalizeSettings
  → generateStylesCss(styleState) → view.renderer.setStyles
```

`ReaderStyleState` / `TypographyDefaults` gain the two bools so `normalizeSettings` is the single resolver. `TYPOGRAPHY_KEYS` includes them so snapshot / restore / `isTypographyOverridden` stay generic.

`onTypographyChange` value type becomes `number | string | boolean`.

## CSS contract (`generateStylesCss`)

Baseline (both flags false) = **today’s stylesheet**, bit-for-bit the same properties and `!important` usage. Tests must keep asserting the current light-theme string shape.

**`overrideFont === true`** — append/replace font-family rules:

- User family with `!important` on `html, body, p, div, span, li, blockquote, td, th, a, h1, h2, h3, h4, h5, h6`
- `code, kbd, pre, samp { font-family: monospace !important; }`
- Still run the family through `cssFontFamily`

**`overrideLayout === true`** — body-text only (`html, body, p, div, li, blockquote`), not headings:

- `font-size`, `line-height`, `letter-spacing`, `text-align` with `!important`
- `p` (keep today’s) `margin-block-end` / `text-indent` with `!important`

`max-width` / `padding-inline` stay on `html, body` regardless of flags.

Theme CSS and `footnotePopupCss()` unchanged. Footnote view already concatenates `generateStylesCss`; flags flow through.

`generatePreviewCss` ignores the flags (no publisher CSS in the preview).

## UI

`SettingsDialog` typography section, after `TypographyPreview`, before the font-size slider:

1. PresetRow 「覆盖字体」— SegmentedControl 关 / 开
2. PresetRow 「覆盖排版」— same

Reading a book: show 「恢复默认」when that key is on the book snapshot. Library: no restore (editing global default).

Reuse `SegmentedControl`. Do not add shadcn `Switch`.

i18n keys (both catalogs):

- `settings.overrideFont`
- `settings.overrideLayout`
- `settings.override.off` / `settings.override.on`

## Persistence details

**preferences.rs**

- `PreferencesDataRaw`: `override_font: Option<bool>`, `override_layout: Option<bool>`, `#[serde(default)]`
- `PreferencesData` / `PreferencesResponse` / `PreferencesPatch`: bool (stored default false)
- `save_preferences`: two more `Option<bool>` args (existing `too_many_arguments` allow)
- `is_supported` does not need extra checks beyond bool

**library.rs `ReadingSettings`**

- `override_font: Option<bool>`, `override_layout: Option<bool>`
- `is_empty` includes them
- `validate_settings`: no extra range; presence is enough

**frontend**

- `src/types/library.ts`
- `src/lib/preferences.ts` response + `invoke("save_preferences", …)`
- `src/lib/reader-styles.ts`

## Compatibility / rollback

- Missing keys → off. Old files load without rewrite.
- Writing the keys makes older builds treat `preferences.json` as corrupt (`deny_unknown_fields`). Same as prior typography fields; ship with the next app version.
- Rollback: revert the CSS branches first if a book looks wrong; flags default off so most users are unaffected.

## Tradeoffs

| Choice | Why |
| --- | --- |
| Strengthen user CSS, don’t strip publisher sheets | Keeps colors/images/heading chrome (R3/out of scope) |
| `Option<bool>` on the book | Allows explicit off while global is on |
| SegmentedControl not Switch | No new UI primitive |
| Flags on `TypographyKey` | Snapshot/restore path already exists |

## Risks

- `div { font-size !important }` can flatten some designed blocks that are not headings. Accept for MVP; headings are excluded.
- `* { font-family }` would also restyle `code`; explicit `code, pre` exception is required.
- `save_preferences` argument list grows again; do not refactor to a struct in this task.
