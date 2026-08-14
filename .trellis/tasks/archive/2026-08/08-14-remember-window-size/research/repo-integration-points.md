# Research: repo integration points

- Query: exact files and conventions in THIS repo the implementer must touch or must not touch for `tauri-plugin-window-state`
- Scope: internal
- Date: 2026-08-14

## Findings

### Files Found

| File Path | Description | Touch? |
|---|---|---|
| `src-tauri/src/lib.rs` | Plugin order, `setup`, `on_window_event`, `invoke_handler` | **yes** — register plugin; optionally `show()` if `visible: false` |
| `src-tauri/Cargo.toml` | Desktop-only target deps | **yes** — add crate next to single-instance |
| `src-tauri/Cargo.lock` | Resolved crate graph (`tauri 2.11.5`) | **yes** — via `cargo add`, not by hand |
| `src-tauri/tauri.conf.json` | Window 800×600, no `visible` | **yes** — add `"visible": false` only |
| `src-tauri/capabilities/default.json` | `core:default`, `core:window:allow-destroy` | **no** if frontend never calls the plugin |
| `src-tauri/src/preferences.rs` | `preferences.json` + `deny_unknown_fields` | **must not** add window fields |
| `src/lib/preferences.ts` | Frontend prefs invoke | **must not** |
| `package.json` | No `@tauri-apps/plugin-*` today | **must not** add JS plugin |
| `.trellis/spec/frontend/quality-guidelines.md` | Plugin registration convention | **do not edit** from implement (spec skill owns this) |
| `src-tauri/src/library.rs` | Rust-only `DialogExt` precedent | **no** |
| `src-tauri/src/main.rs` | `litera_lib::run()` only | **no** |

### `src-tauri/src/lib.rs` plugin order

Current sequence (`lib.rs` 26–38):

```26:38:src-tauri/src/lib.rs
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_paths::handle_second_instance(app, args, cwd);
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
```

Rules already in force:

1. `tauri-plugin-single-instance` **must remain the first plugin** (spec + product fact).
2. Live cfg is `#[cfg(any(target_os = "macos", windows, target_os = "linux"))]`, **not** the spec snippet’s `#[cfg(desktop)]`. Match the live cfg.
3. Dialog and shell stay on the un-cfg’d chain (they are normal `[dependencies]`).
4. Window-state is desktop-only (crate `cfg`s out on Android/iOS). Register it **inside the existing desktop block, second**, so `tauri_plugin_window_state::...` is not referenced on mobile.

Do not:

- Insert window-state before single-instance.
- Register it with `Builder::default().build()` (that is `StateFlags::all()`, restores fullscreen).
- Add commands to `invoke_handler` (lines 109–143).
- Remove or rewrite the existing `on_window_event` Destroyed → sidecar shutdown (lines 102–108). The plugin installs its own listeners via `on_window_ready`; they compose.
- Move registration into `setup` unless there is a concrete reason. This repo uses `builder.plugin(...)`.

If `tauri.conf.json` sets `"visible": false`, `setup` (starts line 40) must show `"main"` after restore. `setup` already has `app` and runs after config windows exist. Use `app.get_webview_window("main")` + `show()` / `set_focus()`. Do not invent a new command for this.

### `src-tauri/Cargo.toml` desktop-only deps

```20:34:src-tauri/Cargo.toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
...
tauri-plugin-dialog = "2.7.2"
tauri-plugin-shell = "2"
...

[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-single-instance = "2.4.3"
```

Add `tauri-plugin-window-state = "2.4.1"` **only** under that existing target table. Do not put it in `[dependencies]` (would break mobile / contradict plugin crate cfg). Do not change `tauri` features; window-state does not need `unstable`.

Lockfile currently has `tauri 2.11.5`. Plugin 2.4.1 wants `tauri ^2.8.2`. Compatible. Let cargo update `Cargo.lock`.

### `src-tauri/tauri.conf.json` window config

```13:18:src-tauri/tauri.conf.json
    "windows": [
      {
        "title": "Litera",
        "width": 800,
        "height": 600
      }
    ],
```

- No `label` → Tauri v2 default `"main"` (already referenced by `capabilities/default.json` `"windows": ["main"]`). Do not add a label unless something else requires it.
- No `minWidth` / `minHeight`. Do not add them for this task.
- No `visible`. Add `"visible": false` to avoid the 800×600 flash (see `research/window-state-plugin.md`). Keep `width`/`height` 800/600 — that is the first-launch and corrupt-state fallback (R2/R3).
- Do not change CSP, `identifier` (`com.maplume.litera`), or bundle block.

### `src-tauri/capabilities/default.json`

```1:10:src-tauri/capabilities/default.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-destroy"
  ]
}
```

This file does **not** grant `dialog:default` or `shell:default`. Dialog is used from Rust (`src-tauri/src/library.rs` `use tauri_plugin_dialog::DialogExt`). Shell sidecar spawn is also Rust-only (`.trellis/spec/backend/quality-guidelines.md`: “The WebView capability file does not grant shell execute/spawn permissions”).

`window-state:default` only unlocks JS commands (`filename`, `restore_state`, `save_window_state`). Automatic Rust save/restore does not need it. **Leave this file unchanged** unless a later change calls the plugin from the WebView.

### `.trellis/spec/frontend/quality-guidelines.md` plugin convention

```40:71:.trellis/spec/frontend/quality-guidelines.md
## Tauri 2 Plugin Registration

### Convention: Plugins in lib.rs, permissions in capabilities/
...
`tauri-plugin-single-instance` has no JS API and needs no capability. It **must be the first plugin**.
```

Implications for implement:

- Register in `lib.rs`, do not stuff permissions into Rust.
- Single-instance stays first.
- Window-state with no JS API follows the same exemption as single-instance: no capability required.
- Spec example uses `#[cfg(desktop)]` and a `dialog:default` capability sample. **Live code wins**: use the explicit desktop `cfg` already in `lib.rs`; do not add `dialog:default` “to match the spec sample.”
- Implementer should **not** edit this spec file. If the convention needs a window-state note, that is a later spec-skill change.

### Why `preferences.rs` must not gain window fields

`PreferencesDataRaw` is the on-disk schema:

```66:91:src-tauri/src/preferences.rs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreferencesDataRaw {
    schema_version: u32,
    theme: String,
    // typography fields only...
}
```

Reasons this is a hard no:

1. **PRD R4** — window state must not go into `preferences.json`.
2. **`deny_unknown_fields`** — any extra key written by a newer build makes an older build fail deserialize. `ensure_file` then treats the file as corrupt and **overwrites it with defaults** (lines 305–314), wiping the user’s theme/typography.
3. Explicit comment at line 309: “Do not rewrite: adding new keys would break older builds.”
4. Store root is `app_data_dir()/preferences.json` (`lib.rs:41`, `preferences.rs:294–295`). Plugin state is `app_config_dir()/.window-state.json`. Separate files, separate schemas.
5. Frontend `src/lib/preferences.ts` only knows theme/typography and `invoke("get_preferences"|"save_preferences")`. No window geometry belongs there.

Do not add fields to `PreferencesData`, `PreferencesDataRaw`, `PreferencesPatch`, `PreferencesResponse`, or the TS `AppPreferences` type. Existing `#[cfg(test)]` module in `preferences.rs` (from ~line 567) must keep passing unchanged.

### Existing tests / validation commands

There is **no** window-geometry test harness. Validation is compile + existing suites + a manual desktop check.

Backend (from `src-tauri/`; tests live as `#[cfg(test)]` in `preferences.rs`, `library.rs`, `agent_config.rs`, `sidecar.rs`, `sidecar_protocol.rs`, `open_paths.rs`, `error.rs`):

```bash
cd src-tauri && cargo test
```

Frontend (root `package.json` `"test": "vitest"`; journals also use `npx vitest run`):

```bash
npm test
# or
npx vitest run
```

Typecheck / bundle (only needed if frontend is touched — it should not be):

```bash
npx tsc --noEmit
npm run build
```

Sidecar smoke is **out of scope** unless sidecar files change:

```bash
npm run build:sidecar
npm run smoke:sidecar
```

Release-style check used on past tasks that touched `src-tauri` lockfiles:

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

`--locked` will fail until `Cargo.lock` is updated by `cargo add`. After the lockfile change, `--locked` should pass.

Manual AC (cannot be automated here):

- Resize, quit, relaunch → same size/position/maximized (not fullscreen).
- Fresh profile / delete `~/.config/com.maplume.litera/.window-state.json` (Linux) → 800×600.
- Garbage JSON in that file → app still launches at 800×600.
- Confirm `preferences.json` is unmodified by a resize/quit cycle.

### Must not touch (summary)

- `src-tauri/src/preferences.rs` and `src/lib/preferences.ts`
- `package.json` / `package-lock.json` (no JS plugin)
- `src-tauri/src/library.rs`, sidecar, frontend React
- `.trellis/spec/**` (not an implementer write)
- Plugin order of single-instance
- `invoke_handler` command list
- CSP / file associations / identifier

### Code Patterns

- Desktop plugins: target-cfg Cargo dep + same `cfg` in `lib.rs`.
- Rust-only plugins (single-instance, dialog, shell sidecar): no npm package, no capability.
- Config windows: omit `label` → `"main"`.
- Persistent user data: library/prefs in `app_data_dir`; window-state plugin will use `app_config_dir` on its own.

## External References

- None beyond the plugin research file.

## Related Specs

- `.trellis/spec/frontend/quality-guidelines.md` — plugin registration / single-instance first
- `.trellis/spec/backend/directory-structure.md` — `lib.rs` owns builder + commands; `capabilities/default.json` is the permission file
- `.trellis/spec/backend/quality-guidelines.md` — sidecar smoke / `cargo`+`npm` gates when those layers change
- `.trellis/tasks/08-14-remember-window-size/prd.md` — R1–R4, 800×600 fallback
- `.trellis/tasks/08-14-remember-window-size/research/window-state-plugin.md` — crate API, flags, flash/`show()` coupling

## Caveats / Not Found

- `task.py current` reported no active task; files written under the dispatch path.
- No CI workflow snippet in-repo lists a single “required command” for this feature; past tasks used `cargo test` in `src-tauri` plus `npm test` when frontend moved.
- Spec example (`#[cfg(desktop)]`, `dialog:default`) disagrees with live `lib.rs` / `default.json`. Follow live code.
- Default window label `"main"` is Tauri v2 convention (no `label` key in conf); not spelled out in-repo except via capabilities.
