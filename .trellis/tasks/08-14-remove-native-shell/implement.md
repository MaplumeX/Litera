# Remove native window shell — implement

## Checklist

1. In `src-tauri/src/lib.rs` setup, before the existing `show()` / `set_focus()`:
   - macOS: Overlay title bar + empty title; traffic lights inset into the 48px header if the API exists.
   - other desktop: `set_decorations(false)`.
   - If Overlay cannot be set after create, use a complete `tauri.macos.conf.json` `windows[0]` (do not send a partial windows array).
2. Grant `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close` in `src-tauri/capabilities/default.json`. Keep `allow-destroy`.
3. Add `src/lib/platform.ts` (`detectDesktopOs`, `usesCustomWindowControls`) + unit tests for UA strings.
4. Add `src/components/WindowControls.tsx` + tests:
   - Hidden on macOS UA.
   - Visible on Windows / Linux UA.
   - Buttons call `minimize` / `toggleMaximize` / `close` (never `destroy`).
5. Add i18n keys in `src/locales/zh-CN.ts` and `src/locales/en.ts` for the three aria-labels. Keep key parity (`src/lib/i18n.test.ts`).
6. Update `LibraryView` and reader `App.tsx` headers:
   - `h-12`; macOS left inset; title + spacer as drag regions; double-click → `toggleMaximize`.
   - Mount `WindowControls` at the far right.
   - Do not put `data-tauri-drag-region` on the header root or on buttons / search.
7. Extend tests:
   - `platform.ts` UA cases.
   - `WindowControls` visibility + command calls.
   - Library / reader: drag region present, search/action buttons not marked drag, custom close uses `close`.
   - Update `App.annotations.test.tsx` window mock if the reader header now calls extra window APIs.

Do not touch sidecar, library persistence, preferences schema, or window-state flags.

## Validation

```bash
npm test
npm run build
```

Manual (`npm run tauri dev`):

- Windows / Linux: no system title bar; three buttons on both headers; drag blank header; double-click maximize; min / max / close work; close still flushes progress.
- macOS: no gray title bar; traffic lights visible and usable; no custom window buttons; title / back not under the lights.
- Resize / move / maximize, quit, relaunch → geometry restored; `preferences.json` unchanged.

## Risky points

- Custom close must `close()`, not `destroy()`, or flush is skipped.
- Applying decorations after `show()` flashes the native bar. Keep `visible: false` and change chrome first.
- Platform `tauri.*.conf.json` windows arrays can replace the shared window object. Prefer Rust setup; if using JSON, copy the full `windows[0]`.
- `data-tauri-drag-region` is not inherited. Mark only the title and spacer.
- Library file-drop and window drag are different APIs; do not reuse one for the other.
- Do not persist chrome or geometry in `preferences.json`.

## Rollback

Revert the files in the checklist. No on-disk schema to undo.
