# Desktop Release Pipeline

## Version and tag contract

`package.json`, root `package-lock.json`, `src-tauri/tauri.conf.json`, and the
`[package]` version in `src-tauri/Cargo.toml` stay in lockstep.

- `npm run version:bump -- x.y.z` updates the version files.
- `node scripts/bump-version.mjs --check` validates them and a `vX.Y.Z` tag.
- Release CI uses native Linux, macOS, and Windows runners with the foliate
  submodule checked out.

## Release gates

- `npm ci`
- `npm test -- --run`
- `npx tsc --noEmit`
- `npx vite build`
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`
- Tauri native packaging through `tauri-apps/tauri-action`

The application bundle contains only the Rust executable and WebView assets; no
separately built Agent executable or system Node installation is required.

## Maintainer cut list

1. Bump and check the version.
2. Update `CHANGELOG.md`.
3. Commit, tag `vX.Y.Z`, and push.
4. Inspect and install each draft release artifact before publishing.
