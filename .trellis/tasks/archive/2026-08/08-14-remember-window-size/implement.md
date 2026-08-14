# Implement: remember window size

## Checklist

1. Add `tauri-plugin-window-state = "2.4.1"` to the existing desktop-only target block in `src-tauri/Cargo.toml`. Prefer `cargo add tauri-plugin-window-state --manifest-path src-tauri/Cargo.toml --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'` then pin `2.4.1` if cargo resolves a different 2.x. Do not use `tauri add window-state`.
2. In `src-tauri/src/lib.rs`, register the plugin **after** `tauri-plugin-single-instance` inside the same desktop `cfg` block, with `with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)`.
3. In the existing `setup` closure, after `app.manage(...)` calls, `get_webview_window("main")` then `show()` + `set_focus()`. Ignore those errors; do not fail setup.
4. In `src-tauri/tauri.conf.json` window object, add `"visible": false`. Keep 800×600. Do not add `label`.
5. Do not edit `preferences.rs`, frontend files, or `capabilities/default.json`.
6. Confirm `Cargo.lock` updated under `src-tauri/`.

## Validation

```bash
# After cargo add updates the lockfile:
cargo test --locked --manifest-path src-tauri/Cargo.toml

# Frontend tests should stay green (no frontend change)
npx vitest run
```

Manual (required for AC1–AC8; cannot be covered by current unit tests):

- Fresh launch → 800×600, window is visible (not stuck hidden).
- Resize + move + quit + relaunch → same size and position.
- Maximize + quit + relaunch → maximized.
- Fullscreen + quit + relaunch → not fullscreen.
- Launch does not flash 800×600 then jump.
- `preferences.json` unchanged.

## Risky files / rollback points

- `src-tauri/src/lib.rs` — plugin order (single-instance must stay first); `visible: false` without `show()` leaves a hidden app.
- `src-tauri/tauri.conf.json` — do not change CSP or bundle.
- `src-tauri/Cargo.toml` — keep the plugin on the desktop target cfg only.

Rollback: revert the three files + lockfile. Delete `~/.config/com.maplume.litera/.window-state.json` (Linux) if testing leftover state.

## Follow-up before `task.py start`

- `prd.md` / `design.md` / this file reviewed.
- `implement.jsonl` and `check.jsonl` have real spec/research entries.
- User approved the planning summary.
