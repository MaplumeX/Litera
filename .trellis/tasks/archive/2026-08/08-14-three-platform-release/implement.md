# Implement: three-platform GitHub Release

## Checklist

1. Add `scripts/bump-version.mjs` and a root npm script `version:bump`. Verify it updates the four version files and lockfile top-level versions. Leave current version at `0.1.0`.
2. Set `src-tauri/tauri.conf.json` `bundle.macOS.signingIdentity` to `"-"`.
3. Add `.github/workflows/release.yml` per `design.md` (tag + workflow_dispatch, three-platform matrix, Node 22, dual `npm ci`, version guard, tests + sidecar smoke, tauri-action draft).
4. Write `CHANGELOG.md` with `[0.1.0]` user-visible notes (reader, library, agent sidecar, settings, i18n). Do not dump journal/archive commits.
5. Replace the template `README.md` with product summary, download/install per platform, unsigned macOS/Windows notes, and maintainer release steps (bump → changelog → tag → wait for draft → publish).
6. After code review / check: commit on `main` (do not push until the user confirms).
7. On confirmation: `git push origin main` (includes the existing +24), then `git tag v0.1.0` and `git push origin v0.1.0`.
8. Watch the Actions run. Confirm the draft Release has AppImage, deb, dmg, and NSIS exe. Do not click Publish.

## Validation

Local (Linux):

```bash
node scripts/bump-version.mjs 0.1.0   # idempotent no-op or same-version rewrite
git diff -- package.json sidecar/package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
npm test
npm --prefix sidecar test
# optional if sidecar binary already built:
npm run smoke:sidecar
python3 -c "import json; json.load(open('.github/workflows/release.yml'))"  # will fail — yaml, not json
```

Workflow sanity (no GitHub required):

- YAML parses (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` if PyYAML is present; otherwise visual + `actionlint` if installed).
- Matrix `args` never pass a non-host sidecar target on Linux/Windows.
- `tagName` is `${{ github.ref_name }}`, `releaseDraft: true`.

Remote (acceptance AC6):

- Actions run for tag `v0.1.0` is green on all three jobs, or failures are fixed and the tag rebuilt.
- https://github.com/MaplumeX/Litera/releases shows a **draft** `v0.1.0` with the four installers.

## Risky files / rollback

| Path | Risk |
|---|---|
| `.github/workflows/release.yml` | Wrong token perms or tagName creates a second release; delete draft and fix |
| `src-tauri/tauri.conf.json` | Bad JSON / unknown key breaks `tauri build`; revert the macOS block |
| `scripts/bump-version.mjs` | Regex on Cargo.toml could hit a dependency version; only edit `[package] version` |
| `README.md` / `CHANGELOG.md` | Content only; easy revert |

Do not force-push `main`. Tag `v0.1.0` may be moved only while the GitHub Release is still a draft and the user agrees.

## Follow-up before `task.py start`

- `implement.jsonl` / `check.jsonl` curated.
- User approved this planning summary.
- First push/tag still requires a separate explicit “go” after the work is committed.
