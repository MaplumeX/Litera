# Design: reader system font choice

## Boundaries

- **Rust**: validate and persist `fontFamily` as a string; list installed family names.
- **React**: picker UI, CSS quoting, missing-font badge, same typography scope as today.
- **Not touched**: sidecar, theme, other sliders, app chrome `font-family`, CSP (`font-src` stays as-is because we only use installed family names).

## Contracts

### `list_system_fonts`

```rust
#[tauri::command]
async fn list_system_fonts() -> AppResult<Vec<String>>
```

- Returns sorted, unique family names from `font-kit` `SystemSource::all_families()`.
- Runs in `spawn_blocking`. Enumeration failure → `AppError` (storage/io style message). Empty list is allowed; the three generics still work.
- Does **not** include `serif` / `sans-serif` / `monospace`; frontend prepends them.

### `fontFamily` persistence

Same fields as today (`preferences.json` and per-book `settings.fontFamily`). Schema version stays `1`.

Shared validator (one function used by `validate_patch` and `validate_settings`):

| Value | Result |
|---|---|
| `serif` / `sans-serif` / `monospace` | accept |
| trimmed 1–128 chars, no C0, no `;{}` | accept (even if not installed) |
| empty, whitespace-only, too long, forbidden chars | `InvalidInput` |

`PreferencesData::is_supported` uses the same validator. A named font must not look like a corrupt file.

Frontend `isFontFamily` / `normalizeSettings` / `normalizePreferences` accept any string that passes the same rules. Unknown garbage still falls back to `serif` on read, matching other typography clamps.

### CSS

```
font-family: <quoted-name>, serif
```

Generics stay unquoted and have no extra fallback. Quoting + `, serif` is how missing faces degrade without rewriting JSON.

## Data flow

```
font-kit → list_system_fonts → SettingsDialog combobox
user pick → onTypographyChange("fontFamily", name)
  → library: update_reading_state full settings snapshot
  → no book: save_preferences patch
  → generateStylesCss → view.renderer.setStyles
```

Missing: `savedName ∉ (generics ∪ listed)` → keep `savedName`, badge unavailable, CSS still `"savedName", serif`.

## UI

Replace the three `ChoiceButton`s with a full-width searchable combobox in the existing `PresetRow`.

- Group 1: 衬线 / 无衬线 / 等宽 (i18n labels, preview with generic CSS)
- Group 2: system families (label = family name, preview with that family)
- If current value is missing, show it as the selected item plus an unavailable hint
- Do not change dialog shell size

Add shadcn `popover` + `command` (combobox recipe). Reuse `Select` only if search can be added without a second overlay library; default is combobox because stock `Select` cannot filter.

## Trade-offs

- **font-kit vs plugin**: keep IPC in-tree; no extra capability.
- **Accept uninstalled names**: required so uninstall / other-machine prefs are not wiped.
- **One family**: no `unicode-range` dual stack. Uncovered scripts use the browser/fontconfig fallback after `, serif`.
- **Downgrade**: an older build still has the 3-value `is_supported` check and will reset `preferences.json` if it sees a named font. Same class of break as the last typography expansion; this build and the next must ship together.

## Rollback

Revert the command, validator, picker, and CSS quoting. Users who already saved a named font: new build accepts it; old build would reset prefs — do not ship a mid-way binary that writes named fonts with the old `is_supported`.
