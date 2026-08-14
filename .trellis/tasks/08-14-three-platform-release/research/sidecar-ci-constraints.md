# Sidecar CI constraints

Sources: `sidecar/scripts/target.mjs`, `sidecar/scripts/build.mjs`, `sidecar/scripts/smoke.mjs`, `.trellis/spec/backend/directory-structure.md`.

## No cross-compile

`selectBuildTarget(requested, host)` throws if `requested !== host`. Requested target comes from, in order:

1. `--target` CLI
2. `TAURI_TARGET_TRIPLE`
3. `TAURI_ENV_TARGET_TRIPLE`
4. `CARGO_BUILD_TARGET`
5. `rustc --print host-tuple`

CI must therefore run each platform on a native runner. Passing `--target x86_64-apple-darwin` on `macos-latest` (ARM) would fail the sidecar build. That is why Intel Mac is out of scope unless we add a native Intel runner later.

Supported triples in `target.mjs`:

- `x86_64-unknown-linux-gnu` / `aarch64-unknown-linux-gnu`
- `x86_64-apple-darwin` / `aarch64-apple-darwin`
- `x86_64-pc-windows-msvc` / `aarch64-pc-windows-msvc`

## Build output

`sidecar/scripts/build.mjs` writes:

```
src-tauri/binaries/litera-sidecar-<triple>[.exe]
```

That path is gitignored. Root `prebuild` / `predev` already call `npm run build:sidecar`. `tauri.conf.json` `beforeBuildCommand` is `npm run build`, so `tauri build` (and tauri-action) will rebuild the sidecar on the runner.

Sidecar is its own npm project. CI must `npm ci` in both repo root and `sidecar/` before `tauri build`. `build.mjs` can run `npm ci` itself if deps are missing, but an explicit step is clearer and cacheable.

## Smoke

`npm run smoke:sidecar` refuses binaries that embed the build-machine source path, and starts the packaged binary with an empty `PATH` so it cannot lean on system Node. Worth running on each release runner after sidecar build, before Tauri bundling.

## Version files that must stay in lockstep

| File | Field |
|---|---|
| `package.json` | `version` |
| `sidecar/package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `package.version` |

`package-lock.json` and `sidecar/package-lock.json` also contain the root package version and should be refreshed by the bump script (`npm version` is a poor fit because it only knows one package).
