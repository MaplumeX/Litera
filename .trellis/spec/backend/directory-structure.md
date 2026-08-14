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
├── capabilities/default.json
├── tauri.conf.json
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
