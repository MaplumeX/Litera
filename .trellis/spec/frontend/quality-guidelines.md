# Quality Guidelines

> Code standards and forbidden patterns for the Litera project.

---

## CSP Configuration (Tauri 2)

### Convention: foliate.js CSP Requirements

**What**: `src-tauri/tauri.conf.json` must configure CSP to block EPUB-embedded scripts while allowing `blob:` URLs for foliate.js rendering.

**Why**: EPUB files can contain scripted content (JavaScript in e-book HTML). foliate.js renders chapters via `blob:` URLs. CSP must block scripts except `'self'` but allow `blob:` in resource directives.

**Current CSP** (production):
```
default-src 'self';
script-src 'self';
img-src 'self' blob: data:;
style-src 'self' 'unsafe-inline';
font-src 'self' blob: data:;
media-src 'self' blob:;
connect-src 'self' ipc: http://ipc.localhost;
frame-src 'self' blob:
```

**Dev CSP** (`devCsp`): additionally allows `script-src 'unsafe-inline'` for Vite HMR.

### Don't: Allow blob: in script-src

**Problem**:
```json
"script-src 'self' blob:"
```

**Why it's bad**: EPUB-embedded scripts could execute via blob: URLs, bypassing the security boundary foliate.js requires.

**Instead**: Keep `script-src 'self'` only. `blob:` goes in `img-src`, `font-src`, `media-src`, `frame-src` where foliate.js needs it for rendering, not script execution.

## Tauri 2 Plugin Registration

### Convention: Plugins in lib.rs, permissions in capabilities/

```rust
// src-tauri/src/lib.rs
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_paths::handle_second_instance(app, args, cwd);
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| { /* macOS RunEvent::Opened */ });
}
```

```json
// src-tauri/capabilities/default.json
{
  "permissions": ["dialog:default"]
}
```

**Why**: Tauri 2 separates plugin registration (builder code) from permission grants (capabilities JSON). Don't inline permissions in Rust code.

`tauri-plugin-single-instance` has no JS API and needs no capability. It **must be the first plugin**. File associations live in `tauri.conf.json` `bundle.fileAssociations`, not capabilities. Catching `RunEvent::Opened` requires `build().run(|app, event|)`, not `Builder::run`.

Rust-only plugins already in this repo (single-instance, dialog, shell sidecar, window-state) are **not** granted in `capabilities/default.json`. Live desktop `cfg` is `#[cfg(any(target_os = "macos", windows, target_os = "linux"))]`, not the `#[cfg(desktop)]` snippet above.

## Scenario: main window size / position / maximized

### 1. Scope / Trigger

- Trigger: persist the single `main` window's size, position, and maximized state across launches.
- Storage is OS window geometry, not a reader preference. Do not add fields to `preferences.json` (`deny_unknown_fields` — a new key makes older builds treat the file as corrupt and reset theme/typography).

### 2. Signatures

No new `#[tauri::command]`. Official `tauri-plugin-window-state` 2.4.1 saves on `RunEvent::Exit` and restores on `on_window_ready`.

```rust
// src-tauri/src/lib.rs — desktop cfg block, AFTER single-instance
WindowStateBuilder::default()
    .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
    .build()
```

Cargo: `tauri-plugin-window-state = "2.4.1"` only under
`[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]`.

### 3. Contracts

- Flags: `SIZE | POSITION | MAXIMIZED` only. Default `StateFlags` is `all()` and would restore `FULLSCREEN`.
- File: `{app_config_dir}/.window-state.json` (`com.maplume.litera`). Not `app_data_dir()` / `preferences.json`.
- First launch / unreadable JSON: plugin `unwrap_or_default()` → config `800×600`.
- Off-screen: plugin skips `set_position` if no saved corner intersects `available_monitors()`; size and maximized still apply.
- Window starts `"visible": false` in `tauri.conf.json`. After restore, `setup` must `show()` + `set_focus()` `"main"`. The plugin's own `show()` is gated on `StateFlags::VISIBLE`, which we omit so a hidden window is never persisted.

### 4. Validation & Error Matrix

- Missing / invalid `.window-state.json` → empty map, launch at 800×600, app still starts.
- `show()` / `set_focus()` fail → ignored; setup must not return `Err`.
- Saved `"fullscreen": true` → ignored (flag omitted).

### 5. Good/Base/Bad Cases

- Good: resize + move + maximize, quit, relaunch → same size/position/maximized.
- Base: no state file → 800×600, OS default position, window visible.
- Bad: `"visible": false` without app `show()` → main window stays hidden.

### 6. Tests Required

- `cargo test --locked --manifest-path src-tauri/Cargo.toml` after the lockfile change.
- No unit test for live window geometry. Manual: resize/move/maximize/fullscreen-not-restored; confirm `preferences.json` unchanged.

### 7. Wrong vs Correct

#### Wrong
```rust
// tauri add window-state / Builder::default() with no flags → restores FULLSCREEN
builder.plugin(tauri_plugin_window_state::Builder::default().build());
```

#### Correct
```rust
WindowStateBuilder::default()
    .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
    .build()
```

Do not run `npm run tauri add window-state`: it adds the unused JS package, grants `window-state:default`, and registers `StateFlags::all()`.