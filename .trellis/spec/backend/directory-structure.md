# Directory Structure

> Module organization for the Litera Rust backend and embedded Agent runtime.

```text
src-tauri/
├── src/
│   ├── lib.rs              # Tauri builder and command registration
│   ├── library.rs          # library/import/annotation storage
│   ├── preferences.rs      # global reader preferences
│   ├── agent_config.rs     # provider metadata and credentials
│   ├── pi_sessions.rs      # Pi v3 append-only session storage
│   └── open_paths.rs       # argv/OS-open queue
├── windows-thumbnail/        # isolated cdylib crate: Windows IThumbnailProvider
│   (own [workspace], built separately on Windows CI)
├── windows/hooks.nsh        # NSIS install/uninstall hooks for the DLL
├── capabilities/default.json
├── tauri.conf.json
├── tauri.windows.conf.json  # Windows-only bundle.resources (thumbnail DLL)
└── Cargo.toml

src/agent/
├── runtime/                # Pi Agent lifecycle and event normalization
├── book/                   # browser EPUB module worker
├── sessions/               # decoder, branch projection, typed invoke port
└── transport/              # guarded Tauri native fetch
```

- Register every Tauri command in `src-tauri/src/lib.rs`.
- Blocking filesystem work runs through `spawn_blocking`.
- The desktop bundle has no external Agent binary and does not require Node at runtime.
- EPUB parsing and search stay off the UI thread in one active module worker.
- `windows-thumbnail/` is an isolated Cargo workspace (`[workspace]` in its
  `Cargo.toml`) so its `windows`/`zip`/`image` dependencies do not merge into
  the main workspace.  It is built separately (`cargo build --release`) on
  Windows CI before `cargo test` / `tauri build`, bundled via
  `tauri.windows.conf.json` `bundle.resources`, and auto-registered by NSIS
  hooks.  Non-Windows builds do not list the DLL, so `tauri build.rs` does
  not require the file.
