# Design: fine-tune reader typography

## Architecture

Settings surface, view routing, and AI section stay as they are. This task changes stored types, validation, CSS, and the typography form.

```
preferences.json ── get/save_preferences ──► usePreferences()
      ▲                                        │
      └──────── patch (numbers + enums) ───────┤  library: all typography + theme
                                               │  reader: theme only via same hook
library.json settings ── update_reading_state ◄── reader: full override snapshot

effective = book.settings.field ?? preferences.field ?? builtin
generateStylesCss(effective) ──► ReaderView.setStyles
```

No global store. `App` still owns view, `settingsReturnTo`, and persist routing.

## Stored fields

JSON camelCase. Numbers are finite f64, clamped to the PRD ranges.

| Field | Where | Type after | Notes |
|---|---|---|---|
| theme | preferences only | enum string | unchanged |
| fontSize | both | number px | now also a preference default |
| fontFamily | both | enum string | now also a preference default |
| lineHeight | both | number | dual-read old enums |
| contentWidth | both | number em | new; replaces pageMargin width |
| pagePadding | both | number rem | new; replaces pageMargin padding |
| textAlign | both | enum string | unchanged |
| letterSpacing | both | number em | new |
| paragraphSpacing | both | number em | new |
| firstLineIndent | both | number em | new |
| pageMargin | read-only leftover | old enum | read if new pair missing; never write |

`TypographyKey` becomes every overridable field (all of the above except `theme`).

## Persistence

### preferences.json (schemaVersion stays 1)

`PreferencesData` grows defaulted numeric fields. Custom deserialize for `lineHeight` (enum or number) and leftover `pageMargin`. `get_preferences` returns already-normalized numbers. `save_preferences` patch args become numbers for the continuous fields, plus existing enum args for theme / fontFamily / textAlign.

`ensure_file`: parsed v1 + valid theme is valid even when new keys are missing. Do not rewrite.

Builtin defaults match the PRD table. Missing `fontSize` / `fontFamily` become 16 / serif.

### ReadingSettings

Keep `page_margin: Option<String>` for old books. Add optional numeric fields. Custom deserialize for `line_height`. `validate_settings` checks ranges (finite + in bounds, snap not required on disk) and existing enum allow-lists. Old `pageMargin` enum still accepted on read.

Frontend `normalizeSettings` does the enum → number map and the pageMargin split. `bookSettingsSnapshot` writes only keys that are currently overridden, including `fontSize` / `fontFamily`. It never writes `pageMargin` or `theme`.

## CSS

`generateStylesCss`:

```css
html, body {
  font-family: …;
  font-size: …px !important;
  line-height: …;
  letter-spacing: …em;
  max-width: …em;
  margin-inline: auto;
  padding-inline: …rem;
  text-align: …;
}
p {
  margin-block-end: …em !important;
  text-indent: …em !important;
}
```

Theme CSS unchanged.

## UI

Add shadcn `Slider`. Each continuous row: label, current value, optional 恢复默认, slider.

Discrete rows stay `ChoiceButton`: 字体, 对齐, 主题.

Library and reader both enable every typography control. `hasBook` no longer disables fonts. Restore buttons still only when entered from the reader **and** that key is present on `currentBook.settings`.

`App` persist:

- From library: any typography change → `updatePreferences`.
- From reader: any typography change → full book snapshot with that key set.
- Restore → snapshot with that key omitted.
- Theme → `setTheme` / preferences, any view.

Drop the font-only persist path. One `onTypographyChange` (or a small typed patch) covers sliders and font family.

## Compatibility

- Old `{ fontSize, fontFamily }` books: those two keys remain overrides.
- Old `lineHeight` / `pageMargin` strings: mapped on read; next persist writes numbers / split fields.
- Theme-only preferences file: theme kept; new defaults fill in memory only.
- Chat LLM path unchanged.

## Trade-offs

- No live preview: accepted. User chose it over a fake paragraph or reader overlay.
- Split measure vs padding: two fields instead of interpolating one; leftover `pageMargin` is migrate-on-read only.
- Injecting `p` styles overrides EPUB paragraph CSS. Needed for 段距/缩进 to actually apply.
- Forward-only preferences/library keys: old builds will reset theme if they open a new file.

## Rollback

Revert the feature commit. Disk that already has new keys is unreadable by the previous build (`deny_unknown_fields`). Do not ship a mid-way writer.
