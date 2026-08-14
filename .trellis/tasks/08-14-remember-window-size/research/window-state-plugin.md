# Research: window-state plugin

- Query: official `tauri-plugin-window-state` setup for Tauri 2 — crate/version, Builder + StateFlags, JS package, capability, `visible: false`, state file path, desktop-only cfg, off-screen/missing-monitor, known bugs, new commands
- Scope: mixed
- Date: 2026-08-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src-tauri/src/lib.rs` | Current plugin registration (`single-instance` first, then dialog/shell) |
| `src-tauri/Cargo.toml` | Desktop-only target deps already used for `tauri-plugin-single-instance` |
| `src-tauri/tauri.conf.json` | Main window is 800×600, no `label`, no `visible` |
| `src-tauri/capabilities/default.json` | Only `core:default` + `core:window:allow-destroy` |
| `src-tauri/Cargo.lock` | Resolved `tauri = 2.11.5` |

### Crate + recommended version

- Crate: `tauri-plugin-window-state`
- Latest stable on crates.io: **2.4.1** (2025-10-27). Requires Rust ≥ 1.77.2.
- docs.rs 2.4.1 depends on `tauri ^2.8.2`. This repo already resolves `tauri 2.11.5` (`src-tauri/Cargo.lock` around line 3854). Compatible.
- Pin to `"2.4.1"` next to the other desktop plugin pin (`tauri-plugin-single-instance = "2.4.3"`). Do **not** use `tauri-plugin-window-state = "2.0.0"` from the plugin README; that is stale.
- Do **not** run `npm run tauri add window-state` / `cargo tauri add window-state`. That installer:
  1. adds the unused JS package
  2. adds `window-state:default` to capabilities
  3. registers `Builder::default()`, whose flags are `StateFlags::all()` (includes `FULLSCREEN`)

Official install that matches this repo’s Cargo target pattern:

```text
cargo add tauri-plugin-window-state --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
```

Docs: <https://v2.tauri.app/plugin/window-state/>
Crate: <https://crates.io/crates/tauri-plugin-window-state>
API: <https://docs.rs/tauri-plugin-window-state/2.4.1/tauri_plugin_window_state/>
Source: <https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/window-state>

### Rust registration pattern

Plugin crate API (docs.rs 2.4.1):

- `tauri_plugin_window_state::Builder::default()` / `Builder::new()`
- `Builder::with_state_flags(StateFlags)` — “Sets the state flags to control what state gets restored and saved.”
- `Builder::build()` → `TauriPlugin<R>`
- Default `StateFlags` is `all()`, **not** size-only.

Register on the Tauri `Builder` (plugin README + this repo’s dialog/shell style), **after** `tauri-plugin-single-instance`, behind the same desktop `cfg`. Do not copy the docs-site `setup(|app| app.handle().plugin(...))` snippet unless needed; this repo registers plugins on the builder before `setup`.

```rust
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
{
    builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_paths::handle_second_instance(app, args, cwd);
        }))
        .plugin(
            WindowStateBuilder::default()
                .with_state_flags(
                    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                )
                .build(),
        );
}
```

Automatic behavior after `build()` (plugin `lib.rs`):

- `setup`: load `{app_config_dir}/.window-state.json`, or empty map on any IO/JSON error (`unwrap_or_default()`).
- `on_window_ready`: `restore_state(state_flags)` unless the window label is denylisted.
- `WindowEvent::CloseRequested`: update in-memory cache.
- `RunEvent::Exit`: `save_window_state(state_flags)` to disk.

No app-owned save/restore loop is required.

### Exact StateFlags for size + position + maximized only

From plugin `lib.rs` bitflags:

| Flag | Bit | Persist? |
|---|---|---|
| `SIZE` | `1 << 0` | **yes** |
| `POSITION` | `1 << 1` | **yes** |
| `MAXIMIZED` | `1 << 2` | **yes** |
| `VISIBLE` | `1 << 3` | no |
| `DECORATIONS` | `1 << 4` | no |
| `FULLSCREEN` | `1 << 5` | **no** (product) |

Use:

```rust
StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
```

Do **not** use:

- `StateFlags::all()` / `Builder::default()` without `with_state_flags` — restores `FULLSCREEN` + `VISIBLE` + `DECORATIONS`
- `StateFlags::all() & !StateFlags::FULLSCREEN` — still persists visibility/decorations, which the product did not ask for

Saved JSON always contains every `WindowState` field (`width`, `height`, `x`, `y`, `prev_x`, `prev_y`, `maximized`, `visible`, `decorated`, `fullscreen`). Flags only control which fields are **applied** on restore and **updated** on save. Omitting `FULLSCREEN` means a leftover `"fullscreen": true` in an old file is ignored.

### JS package `@tauri-apps/plugin-window-state`

**Not required** for automatic save/restore.

Official usage page: “After adding the window-state plugin, all windows will remember their state when the app is being closed and will restore to their previous state on the next launch.” JS APIs (`saveWindowState`, `restoreStateCurrent`, `filename`) are optional manual hooks.

This repo’s `package.json` has no `@tauri-apps/plugin-*` packages. Dialog is used from Rust (`library.rs` `DialogExt`), not from the WebView. Same pattern applies here: Rust-only plugin, no npm dep.

### `window-state:default` capability

**Not required** if the frontend never invokes the plugin.

`window-state:default` only grants the three **JS/IPC** commands (`allow-filename`, `allow-restore-state`, `allow-save-window-state`) defined in the plugin’s `permissions/default.toml`. Automatic restore/save runs inside the Rust plugin (`on_window_ready` / `RunEvent::Exit`) and does not go through those commands.

Repo precedent:

- Spec says official plugins are “registered in Rust and granted in capabilities”, but immediately exempts `tauri-plugin-single-instance` because it has no JS API (`.trellis/spec/frontend/quality-guidelines.md` lines 69–71).
- Live `src-tauri/capabilities/default.json` does **not** include `dialog:default` or `shell:default`, even though both plugins are registered. Dialog is Rust-only; shell sidecar spawn is also Rust-only.

Adding `window-state:default` without installing the JS package is unused surface. Omit it unless a later task calls the plugin from the WebView.

### `visible: false` flash prevention — who shows the window

Official tip (v2 plugin page): restore happens **after** window creation, so set `visible: false` on the window; “the plugin will show the window when it restores the state.”

That show is **gated on `StateFlags::VISIBLE`**. Plugin `restore_state`:

```rust
if flags.contains(StateFlags::VISIBLE) && should_show {
    self.show()?;
    self.set_focus()?;
}
```

Product flags omit `VISIBLE`, so the plugin **will not** call `show()`. Consequences:

1. Keep the current default (`visible` omitted → true) → possible 800×600 flash, then jump to saved geometry.
2. Set `"visible": false` in `tauri.conf.json` **and** show the window from app code after restore.

Recommended for this product (exact three flags + no flash):

- `src-tauri/tauri.conf.json` `app.windows[0]`: add `"visible": false`. Keep `width: 800`, `height: 600`.
- In existing `setup` (`src-tauri/src/lib.rs` ~line 40), after stores are managed, show the config window:

```rust
if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
}
```

Window label: `tauri.conf.json` does not set `label`; Tauri v2 defaults the first config window to `"main"`. Capabilities already list `"windows": ["main"]`.

Do **not** add `VISIBLE` just to reuse the plugin’s `show()`. That would persist hidden state and could relaunch an invisible main window.

If `visible: false` is set and nobody calls `show()`, the app stays invisible. This is the highest-risk integration footgun.

### Where the state file is stored

Plugin constants + save/load:

- Filename: `DEFAULT_FILENAME = ".window-state.json"`
- Directory: `app.path().app_config_dir()` (not `app_data_dir()`)

`app_config_dir` = `config_dir/${bundle_identifier}`. Identifier is `com.maplume.litera` (`tauri.conf.json` line 5).

| OS | Path |
|---|---|
| Linux | `$XDG_CONFIG_HOME/com.maplume.litera/.window-state.json` or `~/.config/com.maplume.litera/.window-state.json` |
| macOS | `~/Library/Application Support/com.maplume.litera/.window-state.json` |
| Windows | `{FOLDERID_RoamingAppData}/com.maplume.litera/.window-state.json` |

This repo’s library + `preferences.json` live under `app_data_dir()` (`lib.rs:41`). On Linux those are different folders (`~/.local/share/...` vs `~/.config/...`). On macOS/Windows config and data share Application Support / RoamingAppData, but the filenames do not collide (`.window-state.json` vs `preferences.json`).

Directory is not configurable (open request: [plugins-workspace#3020](https://github.com/tauri-apps/plugins-workspace/issues/3020)). Filename can be changed via `Builder::with_filename`; keep the default.

First launch / corrupt file: `load_saved_window_states(...).unwrap_or_default()` → empty map. `restore_state` then treats the window as new and leaves the 800×600 config size in place. Missing file, unreadable file, or invalid JSON all take this path. Meets R2/R3 without app code.

### Desktop-only cfg / Cargo.toml target pattern

Plugin crate is compiled out on mobile:

```rust
#![cfg(not(any(target_os = "android", target_os = "ios")))]
```

Official platforms table: Windows / Linux / macOS only.

Match this repo, **not** the spec example’s `#[cfg(desktop)]`:

```toml
# src-tauri/Cargo.toml — existing block at lines 33–34
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-single-instance = "2.4.3"
tauri-plugin-window-state = "2.4.1"
```

Registration `cfg` must be the same, otherwise mobile (or a host without the target dep) fails to compile `tauri_plugin_window_state::...`. `lib.rs` already uses this cfg at lines 29–34 for single-instance.

### Off-screen / missing-monitor behavior

In `restore_state`, `POSITION` is applied only if any of the four saved window corners intersects an `available_monitors()` rect (`MonitorExt::intersects`). Comment in plugin source: “restore position to saved value if saved monitor exists otherwise, let the OS decide where to place the window.”

If the saved monitor is gone or the rect is fully off-screen:

- `set_position` is skipped (OS default placement)
- `SIZE` is still applied independently
- `MAXIMIZED` is still applied if `state.maximized`

No extra “clamp to nearest monitor” code is needed for the product’s “don’t open off-screen” out-of-scope note. The plugin already refuses to move onto a missing display.

When maximized, restore uses `prev_x`/`prev_y` (pre-maximize position) then calls `maximize()`.

### Known bugs that affect size restore or fullscreen

Still relevant for 2.4.1 + this app:

1. **Default flags restore fullscreen.** `StateFlags::default()` / `all()` includes `FULLSCREEN`. Product must pass explicit flags.
2. **`visible: false` without `VISIBLE` leaves the window hidden.** Documented above. Highest integration risk.
3. **macOS undecorated maximize freeze** — plugin 2.0.2 workaround (ignores maximized on resize when undecorated/non-resizable; TODO cites [tauri#5812](https://github.com/tauri-apps/tauri/issues/5812)). Litera uses the default decorated window; N/A unless decorations are later removed.
4. **Physical inner size, not logical.** Since 2.0.0-rc.4, size is stored as physical pixels. 2.2.2 ([#2583](https://github.com/tauri-apps/plugins-workspace/pull/2583)) fixed size drift on a secondary monitor with a different scale factor than the primary. Stay on ≥ 2.2.2 (2.4.1 is fine).
5. **Minimized / maximized save guards.** Size/position are not written while minimized (avoids Windows `-32000`) or while maximized (keeps the restore size). 0×0 sizes are skipped (`width > 0 && height > 0`).
6. **Cannot choose the directory.** Filename only. Not a blocker.

Historical / do not re-litigate:

- [plugins-workspace#926](https://github.com/tauri-apps/plugins-workspace/issues/926) (2024-02, v2 beta): `inner_size()` returned the conf size unless Tauri `unstable` was enabled. The plugin still calls `inner_size()`, but this repo’s `tauri 2.11.5` exposes it as a stable API. No `unstable` feature needed.
- Initial-load deadlock: fixed in 2.0.0-rc.5.
- Tiny window on second launch without a user resize: old #251; current code refuses to save 0×0.

Fullscreen: omitting `FULLSCREEN` is sufficient. Do not add extra “exit fullscreen on quit” logic.

### New Tauri commands

**None.** Do not add `#[tauri::command]` wrappers, do not extend `invoke_handler` in `lib.rs`, do not add frontend `invoke` calls.

Plugin already exposes (Rust) `AppHandleExt::save_window_state` / `WindowExt::restore_state` and (JS, unused) `save_window_state` / `restore_state` / `filename`. Automatic `on_window_ready` + `RunEvent::Exit` covers R1–R3.

## External References

- [Window State plugin (Tauri v2)](https://v2.tauri.app/plugin/window-state/) — setup, auto restore, `visible: false` tip, permissions table
- [docs.rs 2.4.1 Builder / StateFlags](https://docs.rs/tauri-plugin-window-state/2.4.1/tauri_plugin_window_state/) — `with_state_flags`, `DEFAULT_FILENAME`
- [plugin source `lib.rs` (v2 branch)](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/window-state/src/lib.rs) — flags, restore/save, monitor intersection, `app_config_dir`
- [plugin source `cmd.rs`](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/window-state/src/cmd.rs) — JS commands only
- [permissions/default.toml](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/window-state/permissions/default.toml) — `window-state:default` = filename + restore + save
- [changelog](https://tauri.app/release/window-state/all-versions/) — physical size, scale-factor fix, macOS undecorated workaround
- [Tauri PathResolver::app_config_dir](https://docs.rs/tauri/2.11.5/tauri/path/struct.PathResolver.html#method.app_config_dir)

## Related Specs

- `.trellis/spec/frontend/quality-guidelines.md` — plugin registration + single-instance-first + capability split
- `.trellis/tasks/08-14-remember-window-size/prd.md` — R1–R4, no fullscreen, 800×600 fallback, not `preferences.json`

## Caveats / Not Found

- `task.py current` reported no active task; output was written to the dispatch path `.trellis/tasks/08-14-remember-window-size/research/`.
- Plugin docs still show Android/iOS rows on the marketing table; crate `cfg` disables the API on those targets. Treat as desktop-only.
- No first-party automated test in the plugin for “corrupt file → 800×600”; the `unwrap_or_default()` path is the evidence.
- Whether a one-frame flash is acceptable instead of `visible: false` is a UX choice; the official recommendation is `visible: false` plus an explicit show.
