# tauri-action + macOS ad-hoc signing

Sources:

- https://v2.tauri.app/distribute/pipelines/github/
- https://github.com/tauri-apps/tauri-action
- https://v2.tauri.app/distribute/sign/macos/

## Trigger

Official example uses `push` to a `release` branch. Tag trigger is also documented:

```yaml
on:
  push:
    tags:
      - 'v*'
```

We already decided on tags. Do not use the action's default `tagName: app-v__VERSION__` — that would create a second tag style. Point `tagName` at the pushed tag (`${{ github.ref_name }}`) so the action attaches assets to the existing tag.

## Action contract (relevant inputs)

- `tagName`: find or create a release for that tag. If the tag already exists, assets go there.
- `releaseName`: required only when creating a new release.
- `releaseDraft: true`: keep the release draft until a human publishes.
- `releaseDraft` must match the existing release state if the tag already has a release.
- `args`: extra `tauri build` flags (`--target`, `--bundles`).
- `projectPath`: not needed; Tauri app is at repo root (`src-tauri/` is the default layout).
- `uploadUpdaterJson` defaults to true but is only relevant if the updater is configured. We do not enable updater this task.

`permissions: contents: write` is required. If the repo still has default read-only workflow tokens, GitHub returns "Resource not accessible by integration". Fix: Settings → Actions → Workflow permissions → Read and write.

## Recommended matrix for this repo

| Runner | tauri args | Why |
|---|---|---|
| `ubuntu-22.04` | `--bundles appimage,deb` | skip rpm from `targets: all` |
| `macos-latest` | `--target aarch64-apple-darwin --bundles dmg` | Apple Silicon only |
| `windows-latest` | `--bundles nsis` | skip WiX/msi |

`fail-fast: false` so one platform failure does not cancel the others.

Linux apt packages from the official guide (Tauri 2 / webkit 4.1):

```
libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
```

## macOS ad-hoc signing

Without an Apple certificate, set:

```json
"bundle": {
  "macOS": {
    "signingIdentity": "-"
  }
}
```

This is required for Apple Silicon builds downloaded from the internet. It does **not** skip Gatekeeper's "unidentified developer" prompt; users still whitelist in Privacy & Security. It does avoid the worse "app is damaged" state.

Paid Developer ID + notarization stays out of scope.

## Node / Rust in CI

Sidecar packages with `@yao-pkg/pkg` target `node22-*`. Use Node 22 in `actions/setup-node`, not a floating `lts/*` that might drift. Local toolchain today: Node `v22.22.2`, rustc `1.97.1`.
