# Remember window size

## Goal

Close Litera and reopen it at the last desktop window size, position, and maximized state, instead of always starting at the hardcoded 800×600 default.

## Background

Litera is a single-window Tauri v2 desktop app. `src-tauri/tauri.conf.json` `app.windows[0]` is titled Litera, 800×600, with no `label` (Tauri defaults the first window to `main`), no `minWidth` / `minHeight`, and no `visible` override.

There is no `tauri-plugin-window-state`, no custom window-bounds store, and no frontend persistence of window geometry. `preferences.json` (`src-tauri/src/preferences.rs`) stores reading/theme settings only and uses `deny_unknown_fields`; adding window fields there would break older builds that still read the same file.

Plugin registration lives in `src-tauri/src/lib.rs`. Capabilities live in `src-tauri/capabilities/default.json` (`core:default`, `core:window:allow-destroy`). `tauri-plugin-single-instance` is already registered first for desktop targets.

Past session search (`trellis mem` for "window size" / "窗口大小" / "window-state") found no earlier product decision.

## Requirements

- R1. After the user resizes the main window and quits normally, the next launch opens at that last size.
- R2. After the user moves the main window and quits normally, the next launch opens at that last position if the saved rectangle still intersects an available monitor. If the saved monitor is gone, the OS places the window; size and maximized still restore.
- R3. After the user maximizes the main window and quits normally, the next launch is maximized. Un-maximizing then shows the last non-maximized size/position.
- R4. First launch with no saved state uses the current 800×600 default and the OS default position.
- R5. Missing, unreadable, or invalid saved state must not prevent launch; fall back to 800×600.
- R6. Fullscreen is not restored, even if a leftover saved file contains `"fullscreen": true`.
- R7. Window state must not be written into `preferences.json`.
- R8. Launch must not flash the default 800×600 window and then jump to the restored geometry.

## Acceptance Criteria

- [ ] AC1. Resize, quit, relaunch → same size (R1).
- [ ] AC2. Move, quit, relaunch on the same monitor → same position (R2).
- [ ] AC3. Maximize, quit, relaunch → maximized (R3).
- [ ] AC4. Fresh profile / no saved state → 800×600 (R4).
- [ ] AC5. Missing or invalid saved state still launches at 800×600 (R5).
- [ ] AC6. Enter fullscreen, quit, relaunch → not fullscreen (R6).
- [ ] AC7. `preferences.json` schema and contents are unchanged (R7).
- [ ] AC8. Restored launch does not briefly show the default 800×600 size/position first (R8).

## Out of Scope

- Remembering which book / reader view was open.
- Multi-window layouts (the app has one main window).
- Per-monitor custom layouts beyond the plugin’s “skip position if the saved rect is off-screen” behavior.
- Restoring fullscreen, decorations, or a hidden window.
- Minimum window size / preventing the user from making a tiny window.
- Frontend JS API or settings UI for window geometry.

## Key Decisions

- Persist size + position + maximized. Do not persist or restore fullscreen.
- Use official `tauri-plugin-window-state` 2.4.1 with explicit `StateFlags`. Do not store geometry in `preferences.json`.
- Rust-only plugin: no `@tauri-apps/plugin-window-state` npm package, no new Tauri commands, no `window-state:default` capability.
- Prevent restore flash with `"visible": false` in `tauri.conf.json` and an app-owned `show()` / `set_focus()` after restore. Do not add `StateFlags::VISIBLE` (that would persist a hidden main window).

## Technical Notes

See `design.md` and `research/window-state-plugin.md`. State file is `{app_config_dir}/.window-state.json` (`com.maplume.litera`), separate from library/preferences under `app_data_dir()`.
