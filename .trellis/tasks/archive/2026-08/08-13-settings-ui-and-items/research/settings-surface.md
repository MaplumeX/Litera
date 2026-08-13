# Settings surface and style injection

## Current surface

- Root view is `"library" | "reader"` in `App.tsx`.
- `settingsOpen` toggles `SettingsDialog` over either view.
- Chat LLM config is a separate `AgentConfigDialog` owned by `ChatPanel` (`.trellis/spec/frontend/component-guidelines.md`, “Settings entry ownership”).

## Chosen surface

Independent settings **page** (third root view). Library gear and reader Aa navigate to it. Chat gear stays a dialog.

Back from settings must return to the previous view **without** running `handleBackToLibrary` (that flushes, `close_book`, and clears `fileData`).

While the settings page is showing, the reader is not mounted, so typography changes cannot live-preview. Accepted.

## Style injection

`generateStylesCss` in `src/lib/reader-styles.ts` is the only path into `view.renderer.setStyles`. New fields must be added there as CSS on `html, body`:

- `line-height`
- horizontal inset via `max-width` + auto margins (page measure / 页边距)
- `text-align`

No foliate renderer API beyond `setStyles` is required. Preset values are product-locked in `design.md`.
