# System font enumeration for Tauri 2

## Goal

List installed font **family** names so the settings picker can offer them. Apply the chosen name as CSS `font-family` in the foliate iframe. Do not load font file bytes.

## Options

### 1. `font-kit` `SystemSource::all_families()`

Cross-platform wrapper (fontconfig on Linux, Core Text on macOS, DirectWrite on Windows). Returns unique family names. First call can be slow; run in `spawn_blocking`.

Adds a native fontconfig dependency on Linux. That library is already present on desktop Linux.

### 2. Third-party `tauri-plugin-system-fonts`

Thin Tauri v2 plugin around the same idea. Extra permission surface and an unowned crate. The project currently only uses official `tauri-plugin-*` crates.

### 3. Shell out to `fc-list : family`

No new crate. Fragile (locale, missing binary, parsing). Not acceptable as the IPC contract.

## Decision

Use **option 1**. New command `list_system_fonts` in the Rust backend, registered next to `get_preferences`. Do not add a plugin.

Return `Vec<String>` of family names, sorted, de-duplicated. Frontend prepends the three generic CSS families.

## CSS injection

`generateStylesCss` currently interpolates `font-family` raw. Generic names stay unquoted. Named fonts must be quoted and escaped (`\` and `"`), then followed by `, serif` so a missing face falls back without rewriting storage.

## Validation (save path)

Backend is the gate. Accept:

- exact `serif` / `sans-serif` / `monospace`
- other names: trimmed, 1–128 chars, no C0 controls, no `;` `{` `}`

Reject empty / overlong / injection-shaped strings. Do **not** require the name to exist on this machine (user may sync preferences, or uninstall later).

`PreferencesData::is_supported` must use this validator. Keeping the old 3-value enum would treat a saved named font as corrupt and reset theme + typography on next launch.

Share one helper from `library.rs` (preferences already imports typography helpers from there). Do not keep two `VALID_FONT_FAMILIES` arrays.

## Missing font UX

Compare the saved name to `list_system_fonts` plus the three generics. If absent, keep the value, mark the control unavailable, still emit `"Name", serif` in CSS.

## Picker UI

Hundreds of families will not fit as `ChoiceButton`s in the fixed `768×40rem` dialog. Use a searchable combobox (shadcn: add `popover` + `command`). Existing `Select` has no filter.

## Out of this research

Bundling CJK fonts, `@font-face` file import, unicode-range split for CJK vs Latin.
