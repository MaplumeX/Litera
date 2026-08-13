# Settings dialog — design

## Boundaries

- Frontend only. No Rust, preferences schema, library schema, or sidecar changes.
- General settings stay owned by `App`. Chat LLM settings stay owned by `ChatPanel` (`AgentConfigDialog`).
- Reuse shadcn `Dialog` the same way `AgentConfigDialog` does.

## View state

`App` view shrinks to `"library" | "reader"`. Settings is `settingsOpen: boolean`, not a third root view.

| Before | After |
|---|---|
| `view: "library" \| "reader" \| "settings"` | `view: "library" \| "reader"` |
| `settingsReturnTo` | delete; scope comes from `view === "reader"` |
| `openSettings(from)` → `setView("settings")` | `setSettingsOpen(true)` |
| `handleBackFromSettings` → `setView(settingsReturnTo)` | `setSettingsOpen(false)` after flush |
| settings early-return unmounts library/reader | both remaining trees mount `SettingsDialog` |

`editingBook = view === "reader" && Boolean(currentBook || fileData)`.

`openSettings` no longer copies `lastKnownFractionRef` into `currentBook`. That snapshot existed only because opening settings unmounted `ReaderView`. The ref stays for open-book / relocate.

## Component

Rename `SettingsPage` → `SettingsDialog` in `src/components/settings/`.

Props change:

- Drop `onBack`.
- Add `open: boolean` and `onClose: () => void`.
- Keep `bookTitle`, `hasBook`, `styleState`, typography/theme callbacks.

Shell:

- `Dialog` + `DialogContent` following `AgentConfigDialog` (`onOpenChange` only closes when `!v`).
- Wider than the LLM dialog so the left nav still fits: `sm:max-w-3xl`, `max-h-[85vh]`, body scrolls.
- Drop the page-style back header. Close via Dialog X / overlay / Esc.
- Keep the existing left-nav sections and forms.

Render the same dialog instance in both the library and reader `App` trees. Do not rewrite `App` into a single shared shell just to mount it once.

## Data flow

Unchanged persist path:

- Reader open → `bookSettingsSnapshot` + `persistSettings` (per-book replace).
- Library open → `updatePreferences` (global defaults).
- Theme → existing `setGlobalTheme`.
- Locale → existing `setLocale`.

`styleState` already drives `readerRef.setStyles`. With the reader left mounted, slider/theme edits apply immediately. Do not add a separate preview surface.

On close: `flushReadingState()` then `setSettingsOpen(false)`. Failure keeps the dialog open (same as today's back-from-settings).

## Compatibility

No file format migration. Existing `preferences.json` / per-book `settings` stay as they are.

`settings.back` becomes unused. Leave the i18n key in place; do not add new keys for this task.

## Rollback

Revert the frontend files. Persistence and chat config are untouched.

## Spec follow-up (Phase 3.3)

Update frontend specs that currently say `view === "settings"` / `SettingsPage` is a third root view:

- `.trellis/spec/frontend/component-guidelines.md` (Settings entry ownership)
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/directory-structure.md`
