# Design: three-platform GitHub Release

## Architecture

One workflow file, one version source of truth, no extra release service.

```
git tag vX.Y.Z ──push──► GitHub Actions
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
   ubuntu-22.04        macos-latest      windows-latest
   sidecar + tauri     sidecar + tauri   sidecar + tauri
   AppImage, deb       ad-hoc dmg        NSIS exe
          └─────────────────┼─────────────────┘
                            ▼
                 draft GitHub Release
                 tag = vX.Y.Z
```

Human publishes the draft after a smoke check. No updater endpoint.

## Components

### 1. `.github/workflows/release.yml`

- Trigger: `push` tags `v*`. Also `workflow_dispatch` so a failed run can be retried without retagging.
- `permissions.contents: write`.
- `strategy.fail-fast: false`.
- Matrix:

| `runs-on` | `args` |
|---|---|
| `ubuntu-22.04` | `--bundles appimage,deb` |
| `macos-latest` | `--target aarch64-apple-darwin --bundles dmg` |
| `windows-latest` | `--bundles nsis` |

Do **not** pass `--target` on Linux/Windows. Sidecar forbids a requested triple that is not the host; macOS is the only job that pins `--target` because `macos-latest` is Apple Silicon and we want that explicit.

Job steps:

1. `actions/checkout`
2. Linux system deps (webkit 4.1, patchelf, …)
3. `actions/setup-node` with Node **22** and npm cache (root `package-lock.json`)
4. `dtolnay/rust-toolchain@stable` + `swatinem/rust-cache` (`./src-tauri -> target`)
5. `npm ci` at repo root **and** `npm ci --prefix sidecar`
6. Guard: tag (`v` stripped) equals `src-tauri/tauri.conf.json` version, and the four version files match
7. `npm test` (root vitest) and `npm --prefix sidecar test` plus `npm run smoke:sidecar`
8. `tauri-apps/tauri-action@v1` with:
   - `tagName: ${{ github.ref_name }}` (use the pushed tag; do not invent `app-v__VERSION__`)
   - `releaseName: Litera ${{ github.ref_name }}`
   - `releaseBody`: point at `CHANGELOG.md`
   - `releaseDraft: true`
   - `args: ${{ matrix.args }}`
   - `GITHUB_TOKEN`

`beforeBuildCommand` already runs `npm run build` → `prebuild` → sidecar + frontend. tauri-action therefore rebuilds the sidecar on the runner. Binaries stay gitignored.

### 2. Version lockstep

Canonical field: `src-tauri/tauri.conf.json` `version`.

A small Node script `scripts/bump-version.mjs <x.y.z>` writes the same string into:

- `package.json`
- `sidecar/package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` (`version = "..."` under `[package]`)

It also rewrites the two lockfiles' top-level package version if present. First release stays `0.1.0`; the script is for the next bump.

CI guard above fails the release if someone tags without bumping.

### 3. macOS signing

Add to `src-tauri/tauri.conf.json`:

```json
"bundle": {
  "macOS": {
    "signingIdentity": "-"
  }
}
```

Local Linux `tauri build` ignores this. No Apple secrets in CI.

### 4. Docs

- `CHANGELOG.md`: Keep a Changelog, newest first. `## [0.1.0] - 2026-08-14` lists user-visible product, not journal commits.
- `README.md`: replace the create-tauri-app stub with what Litera is, download links (`/releases/latest` after publish; until then `/releases`), per-platform install, unsigned-app notes, and a short “how to cut a release” for the maintainer.

## Trade-offs

| Choice | Why | Cost |
|---|---|---|
| Tag trigger, not `release` branch | Matches existing “main is the only branch” habit; a tag is an explicit ship | Must bump versions before tagging |
| Draft, not published | First CI run can be wrong; publishing is one click | Users cannot download until someone opens the draft |
| `--bundles` in CI, leave `targets: "all"` in config | Local `tauri build` still works; CI skips rpm/msi | Two places describe targets |
| No version bot / semantic-release | Journal commits would pollute notes | Human writes CHANGELOG |
| Ad-hoc macOS sign, no notarization | Unblocks Apple Silicon downloads without a $99 account | Users still click through Gatekeeper |
| Tests + sidecar smoke on the release job | Catches “packaged sidecar embeds source path” on the real runner | Adds a few minutes per platform |

## Compatibility

- No runtime app change except the macOS signing identity used at bundle time.
- Existing local `npm run tauri build` / `npm run build:sidecar` stay valid.
- First public artifacts are unsigned. Document that; do not change CSP, identifier, or file associations.

## Rollout / rollback

1. Land workflow + docs + signingIdentity + bump script on `main`.
2. Push the unpublished 24 commits plus this work.
3. `git tag v0.1.0 && git push origin v0.1.0`.
4. If a platform job fails: fix on `main`, delete the draft if needed, move the tag (`git tag -f` + `git push -f origin v0.1.0`) or cut `v0.1.1`. Prefer a new patch tag if the failed tag already has a published (non-draft) release — it will not.
5. After all three assets appear, maintainer publishes the draft.

If the whole approach is wrong, delete `.github/workflows/release.yml` and the draft release. App behavior is unchanged.
