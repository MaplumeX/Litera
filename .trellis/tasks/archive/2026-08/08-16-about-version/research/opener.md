# tauri-plugin-opener notes

Source: https://v2.tauri.app/plugin/opener/ (fetched 2026-08-16)

## Why this plugin

CSP `default-src 'self'` blocks navigating the WebView to GitHub. There is no existing `openUrl` / shell usage in the repo.

## Install (manual)

Do **not** run `npm run tauri add opener`. Same class of problem as `tauri add window-state` (frontend `quality-guidelines.md`): CLI grants `opener:default`, which includes `allow-open-url`, `allow-reveal-item-in-dir`, and `allow-default-urls` (any `http(s)` / `mailto` / `tel`).

Instead:

1. `cargo add tauri-plugin-opener` in `src-tauri` (crate 2.x; current crates.io 2.5.4)
2. `npm install @tauri-apps/plugin-opener`
3. `builder.plugin(tauri_plugin_opener::init())` in `lib.rs` next to dialog / http
4. Grant a **scoped** capability only

## JS API

```ts
import { openUrl } from "@tauri-apps/plugin-opener";
await openUrl("https://github.com/MaplumeX/Litera");
```

## Capability

```json
{
  "identifier": "opener:allow-open-url",
  "allow": [
    { "url": "https://github.com/MaplumeX/Litera" },
    { "url": "https://github.com/MaplumeX/Litera/releases" }
  ]
}
```

Do not add `opener:default`, `allow-open-path`, or `allow-reveal-item-in-dir`.

## Version API (not opener)

`getVersion()` is `@tauri-apps/api/app`. Covered by existing `core:default`. No new command.
