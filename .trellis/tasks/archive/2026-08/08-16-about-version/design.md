# Design: About section with app version

## Boundaries

- **Frontend** owns the About UI, i18n, `getVersion()`, and `openUrl()` calls.
- **Rust** only registers `tauri-plugin-opener` and grants a URL-scoped capability.
- No new `#[tauri::command]`. No `preferences.json` fields. No new settings persistence.

## UI

Extend `SettingsSection` with `"about"`. Append `{ id: "about", labelKey: "settings.about" }` to the existing left-nav `SECTIONS` array.

When `section === "about"`:

- `DialogDescription` uses a dedicated about blurb (`settings.about.description`), not typography scope.
- Body: product name `Litera`, a version row, two link buttons (repo, releases).
- Reuse existing `Button` (e.g. `variant="link"` or outline). No new shadcn primitive. No extra card/shadow.

Typography / appearance / AI stay unchanged. Default section remains `"typography"`.

## Data flow

```
SettingsDialog open + section=about
  → getVersion()  →  state: version | "—"
  → click link    →  openUrl(constant)  →  OS browser
```

URLs are compile-time constants, not user input:

- `https://github.com/MaplumeX/Litera`
- `https://github.com/MaplumeX/Litera/releases`

`getName()` is unnecessary; the product name is the proper noun `Litera`.

Fetch version when the About section is shown (or when the dialog opens). One in-flight call; ignore stale results if the dialog unmounts.

## Opener vs alternatives

| Option | Why not / why |
| --- | --- |
| `<a href>` / `window.open` | CSP and WebView navigation |
| Custom Rust command + `open` crate | Duplicates official plugin |
| `tauri add opener` | Grants `opener:default` (any https + reveal files) |
| Manual plugin + scoped `allow-open-url` | Chosen |

Details: `research/opener.md`.

## Compatibility

- Existing settings tests keep passing (default typography, appearance, AI, book scope).
- New tests mock `@tauri-apps/api/app` and `@tauri-apps/plugin-opener`.
- Live browser open is manual only (`npm run tauri dev`).

## Rollback

Remove the About nav item and the opener plugin/capability/npm/cargo entries. No data migration.
