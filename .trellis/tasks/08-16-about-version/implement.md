# Implement: About section with app version

## Checklist

1. Add `tauri-plugin-opener` in `src-tauri/Cargo.toml` and `@tauri-apps/plugin-opener` in root `package.json`. Do **not** run `npm run tauri add opener`.
2. Register `tauri_plugin_opener::init()` on the main builder in `src-tauri/src/lib.rs` (with dialog / http, not inside the desktop-only single-instance block).
3. Grant scoped `opener:allow-open-url` in `src-tauri/capabilities/default.json` for only the two GitHub URLs. See `research/opener.md`.
4. Add matching zh-CN / en keys (`settings.about`, description, version label, repo link, releases link, version unavailable placeholder).
5. Extend `SettingsDialog`: `SettingsSection` + `SECTIONS`, about pane, section-specific `DialogDescription`, `getVersion` + `openUrl`.
6. Extend `SettingsDialog.test.tsx`: about nav, version success/failure, `openUrl` args, English `About`, no typography scope on about. Keep existing cases.

## Validation

```bash
npm test -- --run src/components/settings/SettingsDialog.test.tsx src/lib/i18n.test.ts
npx tsc --noEmit
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Manual (`npm run tauri dev`): Settings → 关于 → version matches `0.2.0` → both links open in the system browser.

## Risky files

- `src-tauri/src/lib.rs` — plugin order; do not disturb single-instance / window-state.
- `src-tauri/capabilities/default.json` — do not replace existing window / http grants.
- `src/components/settings/SettingsDialog.tsx` — do not change typography/appearance/AI layout.

## Rollback

Revert the About section, locale keys, opener crate/npm, plugin init, and capability entry. No stored user data.
