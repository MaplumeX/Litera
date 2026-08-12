# Official Packaging Research

## Tauri v2 external binaries

- Official guide: https://v2.tauri.app/develop/sidecar/
- `bundle.externalBin` embeds executables and requires `-$TARGET_TRIPLE` filenames.
- Rust can launch the registered binary through `tauri_plugin_shell::ShellExt::sidecar()`.
- Relative paths are resolved from `src-tauri/tauri.conf.json`; runtime code should pass the registered filename, not a source path.

## Tauri Node sidecar guide

- Official guide: https://v2.tauri.app/learn/sidecar-nodejs/
- The guide packages Node apps as self-contained binaries with `@yao-pkg/pkg` so end users do not need Node.js.
- It then renames the executable for the target triple and registers it with `bundle.externalBin`.

## Tauri Raw IPC

- Official guide: https://v2.tauri.app/develop/calling-rust/#returning-array-buffers
- Serializable return values use JSON and are inefficient for large files.
- `tauri::ipc::Response::new(Vec<u8>)` produces a Raw IPC response received as an array buffer by the frontend.

## Node SEA alternative

- Official docs: https://nodejs.org/api/single-executable-applications.html
- Node SEA can embed a bundled script and assets, but its creation process remains active-development and native/WASM assets require explicit handling.
- For this project, SEA is not the first choice because the current build Node is v22 while the newer direct `--build-sea` flow and dependency asset behavior add avoidable uncertainty. It remains a possible future replacement for pkg.
