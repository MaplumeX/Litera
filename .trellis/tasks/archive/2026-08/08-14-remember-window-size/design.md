# Design: remember window size

## Approach

Register official `tauri-plugin-window-state` 2.4.1 on the desktop Tauri builder. The plugin loads `{app_config_dir}/.window-state.json` on setup, restores on `on_window_ready`, and writes on `RunEvent::Exit`. No app-owned save loop and no new IPC commands.

Details and citations: `research/window-state-plugin.md`.

## Boundaries

| Layer | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-window-state = "2.4.1"` to the existing desktop-only target block next to `tauri-plugin-single-instance`. |
| `src-tauri/src/lib.rs` | Register the plugin after single-instance, same `cfg(any(target_os = "macos", windows, target_os = "linux"))`. In existing `setup`, show + focus the `main` window after stores are managed. |
| `src-tauri/tauri.conf.json` | Add `"visible": false` on the existing window. Keep `width: 800`, `height: 600`. Do not add a label (default is `main`). |
| Frontend | No change. |
| `preferences.rs` / `preferences.json` | No change. |
| `src-tauri/capabilities/default.json` | No change. Automatic restore does not use the plugin’s JS commands. |

Do not run `npm run tauri add window-state`: it installs the unused JS package, grants `window-state:default`, and registers `Builder::default()` (`StateFlags::all()`, including `FULLSCREEN`).

## Contracts

Flags (must be explicit; default is `all()`):

```rust
StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
```

Registration sketch (plugin after single-instance, same desktop cfg):

```rust
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

builder = builder.plugin(
    WindowStateBuilder::default()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .build(),
);
```

Show after restore (required because `VISIBLE` is omitted, so the plugin will not `show()`):

```rust
if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
}
```

`Manager` is already imported in `lib.rs`.

## Data flow

```
quit → plugin RunEvent::Exit → {app_config_dir}/.window-state.json
launch → plugin setup loads file (empty map on any error)
      → window created hidden (visible: false)
      → on_window_ready restore SIZE/POSITION/MAXIMIZED
      → app setup show + focus
```

Corrupt / missing file: `load_saved_window_states(...).unwrap_or_default()` → 800×600 config size.

Off-screen: plugin applies position only if a saved corner intersects `available_monitors()`; otherwise OS places the window. Size and maximized still apply.

## Compatibility

- Desktop only. Crate is `cfg`’d out on Android/iOS. Match this repo’s target cfg, not the spec example’s `#[cfg(desktop)]`.
- Resolved `tauri 2.11.5` satisfies the plugin’s `tauri ^2.8.2`.
- State file does not collide with `preferences.json` (different name; on Linux also a different directory).
- Omitting `FULLSCREEN` means a leftover `"fullscreen": true` in the JSON is ignored.

## Tradeoffs

| Choice | Why |
|---|---|
| Official plugin vs custom prefs fields | Plugin already handles maximize/`prev_*`, minimized `-32000`, 0×0 skip, monitor intersection. `preferences.json` is `deny_unknown_fields`. |
| App `show()` vs `StateFlags::VISIBLE` | Official `visible: false` tip relies on the plugin showing the window, but that path is gated on `VISIBLE`. Adding `VISIBLE` would persist a hidden main window. App-owned `show()` keeps product flags exact. |
| No JS / no capability | Matches dialog/shell/single-instance: Rust-only plugins are not granted in `default.json`. |

## Rollback

Remove the Cargo dep, the `lib.rs` plugin + `show()`, and `"visible": false`. Delete `{app_config_dir}/.window-state.json` if present. No data migration.
