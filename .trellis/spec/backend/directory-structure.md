# Directory Structure

> Module organization for the Litera Rust backend + Node.js sidecar.

---

## Layout

```
src-tauri/
├── src/
│   ├── main.rs            # Entry point (calls lib::run())
│   ├── lib.rs              # Tauri builder, command registration, sidecar + OS-open wiring
│   └── open_paths.rs       # argv / Opened / single-instance queue + take command
├── binaries/               # target-triple sidecar executables (gitignored)
├── capabilities/
│   └── default.json        # Tauri 2 permissions
├── tauri.conf.json         # Tauri config (CSP, window, bundle)
├── Cargo.toml
└── build.rs

sidecar/                    # pi agent Node.js sidecar
├── index.ts                # stdio JSON lines protocol entry
├── scripts/                # target resolution, executable build, smoke tests
├── pkg.config.cjs          # @yao-pkg/pkg asset manifest
├── tsconfig.json           # strict sidecar type-checking
├── package.json            # Agent runtime + packaging dependencies
├── dist/                   # esbuild bundle + copied WASM (gitignored)
└── node_modules/           # gitignored
```

## Key Conventions

- **All Tauri commands in `lib.rs`**: `#[tauri::command]` functions + `invoke_handler` registration in `run()`.
- **Sidecar is a separate npm project**: `sidecar/package.json` is independent from root `package.json`. It has its own `node_modules` and `tsconfig.json`.
- **Standard root builds own sidecar generation**: root `predev`/`prebuild` call `npm run build:sidecar`; a fresh checkout does not require a manual command inside `sidecar/`.
- **Self-contained executable**: esbuild creates `dist/litera-sidecar.cjs`, then `@yao-pkg/pkg` embeds the bundle, Agent dependencies, and `sql-wasm.wasm` into `src-tauri/binaries/litera-sidecar-$TARGET_TRIPLE[.exe]`.
- **Target selection is explicit**: `TAURI_TARGET_TRIPLE`, `TAURI_ENV_TARGET_TRIPLE`, `CARGO_BUILD_TARGET`, or `--target` selects the requested target. Host detection is only the local fallback, and a requested non-host target fails instead of relabeling a host executable.
- **Runtime resolution is Tauri-owned**: `bundle.externalBin` registers `binaries/litera-sidecar`, and Rust uses `app.shell().sidecar("litera-sidecar")`. Production code must not use `CARGO_MANIFEST_DIR`, source-relative paths, or a system `node` executable.
