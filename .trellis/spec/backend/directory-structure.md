# Directory Structure

> Module organization for the Litera Rust backend + Node.js sidecar.

---

## Layout

```
src-tauri/
├── src/
│   ├── main.rs            # Entry point (calls lib::run())
│   └── lib.rs              # Tauri builder, commands, sidecar management
├── capabilities/
│   └── default.json        # Tauri 2 permissions
├── tauri.conf.json         # Tauri config (CSP, window, bundle)
├── Cargo.toml
└── build.rs

sidecar/                    # pi agent Node.js sidecar
├── index.ts                # stdio JSON lines protocol entry
├── tsconfig.json           # TS config (outDir ./dist)
├── package.json            # @earendil-works/pi-coding-agent
├── dist/                   # tsc output (gitignored)
└── node_modules/           # gitignored
```

## Key Conventions

- **All Tauri commands in `lib.rs`**: `#[tauri::command]` functions + `invoke_handler` registration in `run()`.
- **Sidecar is a separate npm project**: `sidecar/package.json` is independent from root `package.json`. It has its own `node_modules` and `tsconfig.json`.
- **Sidecar compiled to `sidecar/dist/`**: `cd sidecar && npx tsc` produces `dist/index.js`. Rust spawns `node sidecar/dist/index.js`.
- **Sidecar path resolution**: Rust uses `env!("CARGO_MANIFEST_DIR")` to locate `sidecar/dist/index.js` relative to `src-tauri/`.