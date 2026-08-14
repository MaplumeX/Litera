# Desktop Release Pipeline

> How Litera is versioned, packaged, and published. Sidecar binaries are host-native; CI must not cross-compile them.

## Scenario: cut a GitHub Release

### 1. Scope / Trigger

- Trigger: shipping installers, changing version numbers, editing `.github/workflows/release.yml`, or adding a new desktop target.
- This is infra: tag contract, version files, sidecar host triple, signing env, Linux sysroot packages.

### 2. Signatures

- `node scripts/bump-version.mjs <x.y.z>` — write the same version to all lockstep files.
- `node scripts/bump-version.mjs --check` — assert lockstep; on `GITHUB_REF=refs/tags/v*` also assert tag `v` + version; write `version=<x.y.z>` to `GITHUB_OUTPUT` when set.
- `npm run version:bump -- <x.y.z>` — wrapper for the write path.
- Git tag: `v<x.y.z>` (example `v0.1.0`). No `app-v__VERSION__`.
- Workflow: `.github/workflows/release.yml` on `push` tags `v*` and `workflow_dispatch`.

### 3. Contracts

Version lockstep (all must equal `src-tauri/tauri.conf.json` `version`):

| File | Field |
| --- | --- |
| `package.json` | `version` |
| `sidecar/package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` only |
| `package-lock.json` | top-level `version` and `packages[""].version` |
| `sidecar/package-lock.json` | same if present |

Sidecar:

- Output: gitignored `src-tauri/binaries/litera-sidecar-<host-triple>[.exe]`.
- Requested triple must equal `rustc --print host-tuple`. Linux/Windows CI args are `--bundles` only. macOS CI may pass `--target aarch64-apple-darwin` because `macos-latest` is that host.
- CI rebuilds with `npm run build:sidecar` then `npm run smoke:sidecar`. Never commit or download a prebuilt sidecar.

Release job:

- `permissions.contents: write`
- `fail-fast: false`
- `tauri-apps/tauri-action@v1` `releaseDraft: true`
- `tagName` on a tag push is `${{ github.ref_name }}`. On `workflow_dispatch` it is `v` + checked app version. Do not invent a second tag style.

Installers (first ship):

| Runner | Bundles |
| --- | --- |
| `ubuntu-22.04` | `appimage`, `deb` |
| `macos-latest` | `dmg` |
| `windows-latest` | `nsis` |

Signing / Linux sysroot:

- `bundle.macOS.signingIdentity` is `"-"` (ad-hoc). No Apple secrets. This avoids “damaged” Apple Silicon downloads; it does not skip Gatekeeper.
- Ubuntu apt must include webkit 4.1 **and** `libfontconfig1-dev` `libfreetype6-dev` (`font-kit` / system font picker).

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Four version files disagree | `--check` exits non-zero; release job stops |
| Tag is `v0.2.0` but app is `0.1.0` | `--check` exits non-zero |
| Tag is `0.1.0` (missing `v`) | `--check` exits non-zero |
| Sidecar `--target` ≠ host | `sidecar/scripts/target.mjs` throws; no relabel |
| Packaged sidecar embeds repo path | `smoke:sidecar` fails |
| One platform job fails | Other platforms still run; Release stays draft, never auto-published |
| Workflow token is read-only | Upload fails with “Resource not accessible by integration”; enable Actions read/write |

### 5. Good / Base / Bad Cases

- Good: versions all `0.1.0`, tag `v0.1.0`, three native jobs, draft Release with AppImage + deb + dmg + NSIS.
- Base: `workflow_dispatch` retry attaches assets to existing `v<version>` draft.
- Bad: bump only `package.json`; pass `--target x86_64-apple-darwin` on `macos-latest`; commit `src-tauri/binaries/`; set `tagName: app-v__VERSION__`.

### 6. Tests Required

- `node scripts/bump-version.mjs --check` — lockstep; with `GITHUB_REF=refs/tags/v0.1.0` passes; `v0.2.0` fails.
- `sidecar/scripts/target.mjs` / smoke — non-host target throws; smoke rejects source-path leak.
- Do not treat a green local `tsc` as proof the GitHub matrix works. First real proof is the draft Release assets.

### 7. Wrong vs Correct

#### Wrong

```yaml
args: --target x86_64-apple-darwin   # on macos-latest ARM
tagName: app-v__VERSION__
# apt without libfontconfig1-dev libfreetype6-dev
```

#### Correct

```yaml
# macos-latest only
args: --target aarch64-apple-darwin --bundles dmg
tagName: ${{ github.ref_name }}
releaseDraft: true
```

```json
"macOS": { "signingIdentity": "-" }
```

## Maintainer cut list

1. `npm run version:bump -- x.y.z` (skip if already that version).
2. Add `CHANGELOG.md` section.
3. Commit, `git tag vX.Y.Z`, push `main` and the tag.
4. Wait for three jobs; inspect the draft; install once; Publish.

Out of scope until a later task: updater, paid signing / notarization, Linux ARM, Windows ARM, Intel Mac, store listings, PR packaging CI.
