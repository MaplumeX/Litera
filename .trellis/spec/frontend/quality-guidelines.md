# Quality Guidelines

> Code standards and forbidden patterns for the Litera project.

---

## CSP Configuration (Tauri 2)

### Native model transport and EPUB worker

Embedded model traffic uses `createGuardedNativeFetch`, never WebView `fetch`.
It accepts HTTP(S) only, requires the request origin to equal the active
Rust-resolved provider origin, rejects redirects, and emits credential-free
errors. The broader Tauri HTTP capability is not the authorization boundary.

Built-in model API/base URL/context limits come from the exact pinned Pi model
catalog, not a provider-wide guessed `openai-completions` shape. Custom
OpenAI-compatible models use the Rust-returned metadata. Provider exceptions,
malformed request URLs, and native transport errors must be converted to
credential-free messages before reaching reducer state or logs.

EPUB extraction, TOC ownership, chapter windowing, and search run in a Vite
module worker. A book switch terminates the old worker and rejects pending calls.
Keep `script-src 'self'`; EPUB scripts and `blob:` script execution are not used.

### Convention: foliate.js CSP Requirements

**What**: `src-tauri/tauri.conf.json` must configure CSP to block EPUB-embedded scripts while allowing `blob:` URLs for foliate.js rendering.

**Why**: EPUB files can contain scripted content (JavaScript in e-book HTML). foliate.js renders chapters via `blob:` URLs. CSP must block scripts except `'self'` but allow `blob:` in resource directives.

**Current CSP** (production):
```
default-src 'self';
script-src 'self';
img-src 'self' blob: data:;
style-src 'self' 'unsafe-inline';
font-src 'self' blob: data:;
media-src 'self' blob:;
connect-src 'self' ipc: http://ipc.localhost;
frame-src 'self' blob:
```

**Dev CSP** (`devCsp`): additionally allows `script-src 'unsafe-inline'` for Vite HMR.

### Don't: Allow blob: in script-src

**Problem**:
```json
"script-src 'self' blob:"
```

**Why it's bad**: EPUB-embedded scripts could execute via blob: URLs, bypassing the security boundary foliate.js requires.

**Instead**: Keep `script-src 'self'` only. `blob:` goes in `img-src`, `font-src`, `media-src`, `frame-src` where foliate.js needs it for rendering, not script execution.

### Convention: chrome fonts stay same-origin

**What**: App chrome ships `@fontsource-variable/geist`. Vite emits woff2 under `dist/assets/`. That satisfies `font-src 'self'`. User-selected system faces use the OS; do not add a Google Fonts CDN or a second CJK webfont package to make a Chinese default.

**Why**: Google Fonts or any `https://fonts.gstatic.com` URL is blocked. Loosening `font-src` to fix a 404 would also let a book iframe load remote fonts.

**Don't**: Add a `<link>` to fonts.google.com, or add `https:` to `font-src` because a font failed to load. Fix the Fontsource import instead.

**Related**: frontend `component-guidelines.md` "app chrome is a cool product-tool surface".

## Tauri 2 Plugin Registration

### Convention: Plugins in lib.rs, permissions in capabilities/

```rust
// src-tauri/src/lib.rs
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_paths::handle_second_instance(app, args, cwd);
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| { /* macOS RunEvent::Opened */ });
}
```

```json
// src-tauri/capabilities/default.json
{
  "permissions": ["dialog:default"]
}
```

**Why**: Tauri 2 separates plugin registration (builder code) from permission grants (capabilities JSON). Don't inline permissions in Rust code.

`tauri-plugin-single-instance` has no JS API and needs no capability. It **must be the first plugin**. File associations live in `tauri.conf.json` `bundle.fileAssociations`, not capabilities. Catching `RunEvent::Opened` requires `build().run(|app, event|)`, not `Builder::run`.

Rust-only plugins already in this repo (single-instance, dialog, window-state) are **not** granted in `capabilities/default.json`. `tauri-plugin-opener` is JS-facing and **is** granted there — URL-scoped only (see "Settings About / system browser links"). Live desktop `cfg` is `#[cfg(any(target_os = "macos", windows, target_os = "linux"))]`, not the `#[cfg(desktop)]` snippet above.

## Scenario: Settings About / system browser links

### 1. Scope / Trigger

- Trigger: show the installed app version and open the GitHub repo / Releases in the OS browser from Settings → About.
- CSP `default-src 'self'` blocks WebView navigation to GitHub. Do not use `<a href>` or `window.open`.

### 2. Signatures

No new `#[tauri::command]`.

```ts
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

await getVersion(); // e.g. "0.2.0"
await openUrl("https://github.com/MaplumeX/Litera");
```

```rust
// src-tauri/src/lib.rs — main builder, with dialog / http
.plugin(tauri_plugin_opener::init())
```

### 3. Contracts

- Product name on the About pane is the proper noun `Litera` (not translated, not `getName()`).
- Version comes from `getVersion()` when Settings is open and the section is `about`. Do not hardcode the version in the component.
- URLs are compile-time constants only:
  - `https://github.com/MaplumeX/Litera`
  - `https://github.com/MaplumeX/Litera/releases`
- Links are `Button`s that call `openUrl`. Capability must list those exact URLs under `opener:allow-open-url`.
- About `DialogDescription` is `settings.about.description`, not typography scope (`settings.editingDefault` / `settings.editingBook`).
- Do not add About to `preferences.json` or a new window / route / library button.

### 4. Validation & Error Matrix

- `getVersion` rejects → log; show `settings.about.versionUnavailable` (`—`); keep both links.
- `openUrl` rejects → log; leave Settings open on About.
- URL not in the capability allow list → plugin denies; same as `openUrl` reject.
- Dialog unmounts mid-`getVersion` → ignore the result (`disposed` flag).

### 5. Good/Base/Bad Cases

- Good: Settings → 关于 shows `Litera` + `0.2.0`; each button calls `openUrl` with one constant URL.
- Base: `getVersion` still pending → `—` (same placeholder as failure).
- Bad: `<a href={url}>`, `opener:default`, or `npm run tauri add opener` (grants any https + reveal files).

### 6. Tests Required

- About nav appears; selecting it hides typography / appearance / AI controls.
- Mock `getVersion` → `"0.2.0"` is visible; reject → wait for the error log, then assert `—` and that `0.2.0` is absent. Do not treat the initial `null` render as the failure case.
- Mock `openUrl` with the two GitHub URLs. `openUrl` reject does not call `onClose`.
- Locale `en` labels the nav `About`.
- Existing typography / appearance / AI / book-scope tests still pass.

### 7. Wrong vs Correct

#### Wrong
```ts
<a href="https://github.com/MaplumeX/Litera">GitHub</a>
// or: npm run tauri add opener  → opener:default
```

#### Correct
```ts
<Button type="button" variant="link" onClick={() => void openUrl(ABOUT_REPO_URL)}>
  {t("settings.about.repo")}
</Button>
```

```json
{
  "identifier": "opener:allow-open-url",
  "allow": [
    { "url": "https://github.com/MaplumeX/Litera" },
    { "url": "https://github.com/MaplumeX/Litera/releases" }
  ]
}
```

Do not grant `allow-open-path` or `allow-reveal-item-in-dir`. Install the crate and `@tauri-apps/plugin-opener` by hand.

## Scenario: main window size / position / maximized

### 1. Scope / Trigger

- Trigger: persist the single `main` window's size, position, and maximized state across launches.
- Storage is OS window geometry, not a reader preference. Do not add fields to `preferences.json` (`deny_unknown_fields` — a new key makes older builds treat the file as corrupt and reset theme/typography).

### 2. Signatures

No new `#[tauri::command]`. Official `tauri-plugin-window-state` 2.4.1 saves on `RunEvent::Exit` and restores on `on_window_ready`.

```rust
// src-tauri/src/lib.rs — desktop cfg block, AFTER single-instance
WindowStateBuilder::default()
    .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
    .build()
```

Cargo: `tauri-plugin-window-state = "2.4.1"` only under
`[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]`.

### 3. Contracts

- Flags: `SIZE | POSITION | MAXIMIZED` only. Default `StateFlags` is `all()` and would restore `FULLSCREEN`.
- File: `{app_config_dir}/.window-state.json` (`com.maplume.litera`). Not `app_data_dir()` / `preferences.json`.
- First launch / unreadable JSON: plugin `unwrap_or_default()` → config `800×600`.
- Off-screen: plugin skips `set_position` if no saved corner intersects `available_monitors()`; size and maximized still apply.
- Window starts `"visible": false` in `tauri.conf.json`. After restore, `setup` must `show()` + `set_focus()` `"main"`. The plugin's own `show()` is gated on `StateFlags::VISIBLE`, which we omit so a hidden window is never persisted.

### 4. Validation & Error Matrix

- Missing / invalid `.window-state.json` → empty map, launch at 800×600, app still starts.
- `show()` / `set_focus()` fail → ignored; setup must not return `Err`.
- Saved `"fullscreen": true` → ignored (flag omitted).

### 5. Good/Base/Bad Cases

- Good: resize + move + maximize, quit, relaunch → same size/position/maximized.
- Base: no state file → 800×600, OS default position, window visible.
- Bad: `"visible": false` without app `show()` → main window stays hidden.

### 6. Tests Required

- `cargo test --locked --manifest-path src-tauri/Cargo.toml` after the lockfile change.
- No unit test for live window geometry. Manual: resize/move/maximize/fullscreen-not-restored; confirm `preferences.json` unchanged.

### 7. Wrong vs Correct

#### Wrong
```rust
// tauri add window-state / Builder::default() with no flags → restores FULLSCREEN
builder.plugin(tauri_plugin_window_state::Builder::default().build());
```

#### Correct
```rust
WindowStateBuilder::default()
    .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
    .build()
```

Do not run `npm run tauri add window-state`: it adds the unused JS package, grants `window-state:default`, and registers `StateFlags::all()`.

## Scenario: main window chrome (no OS title bar)

### 1. Scope / Trigger

- Trigger: the single `main` window must not show an OS title bar. macOS keeps native traffic lights; Windows / Linux draw min / max / close on the existing library and reader headers.
- Do not add a second titlebar row. Do not persist chrome in `preferences.json`.

### 2. Signatures

No new `#[tauri::command]`. Chrome is applied in `src-tauri/src/lib.rs` `setup` on the existing `main` window **before** `show()` / `set_focus()`.

```rust
if let Some(window) = app.get_webview_window("main") {
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
        let _ = window.set_title("");
    }
    #[cfg(any(windows, target_os = "linux"))]
    {
        let _ = window.set_decorations(false);
    }
    let _ = window.show();
    let _ = window.set_focus();
}
```

Frontend: `src/lib/platform.ts` (`detectDesktopOs` / `usesCustomWindowControls` from `navigator.userAgent`). `WindowControls` calls `getCurrentWindow().minimize()` / `toggleMaximize()` / `close()`.

### 3. Contracts

- Shared `tauri.conf.json` stays `"visible": false` and does **not** set `"decorations": false` (that would drop macOS traffic lights).
- macOS: Overlay + empty title. Tauri 2.11.5 `WebviewWindow` has no post-create `set_traffic_light_position`; pad the header `pl-[72px]` instead. Do not draw custom traffic lights.
- Windows / Linux: `set_decorations(false)` while hidden, then `show()`.
- Capabilities in `src-tauri/capabilities/default.json`: keep `core:window:allow-destroy`; also grant `allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`.
- Custom close must call `close()`, never `destroy()`. `App.tsx` `onCloseRequested` still `preventDefault` → flush ≤2s → `destroy()`.
- `data-tauri-drag-region` is **not inherited**. Mark only the title node and the flex spacer. Buttons and search must not have it.
- Double-click a drag node (`buttons === 1`, `detail === 2`) → `toggleMaximize()`. The attribute alone does not maximize.
- Platform `tauri.*.conf.json` `windows` arrays can replace the shared `windows[0]`. Prefer Rust setup. If JSON is required, copy the full window object.
- Do not add `@tauri-apps/plugin-os`.

### 4. Validation & Error Matrix

- `set_title_bar_style` / `set_decorations` / `show` / `set_focus` fail → ignored; setup must not return `Err`.
- Custom close via `destroy()` → flush skipped (reading progress can be lost).
- Shared `"decorations": false` → macOS loses traffic lights.
- Chrome applied after `show()` → native title bar flashes.

### 5. Good/Base/Bad Cases

- Good: launch hidden → Overlay or undecorated → show. macOS traffic lights usable; Win/Linux custom buttons on both headers.
- Base: drag title / spacer moves the window; search and toolbar buttons still click.
- Bad: `data-tauri-drag-region` on the header root, or close via `destroy()`.

### 6. Tests Required

- `platform.ts`: Mac / Win / Linux / unknown UA.
- `WindowControls`: hidden on Mac UA; visible on Win/Linux; buttons call minimize / toggleMaximize / `close` (not `destroy`).
- Library + reader: `h-12`; Mac `pl-[72px]` and no custom buttons; title + spacer have drag + `select-none`; search/actions do not; spacer double-click → `toggleMaximize`.
- Pin Windows UA in chrome tests; do not depend on jsdom's host UA.
- `npm test` + `npm run build`. Live OS chrome is manual (`npm run tauri dev`).

### 7. Wrong vs Correct

#### Wrong
```json
{ "decorations": false, "visible": false }
```
```tsx
onClick={() => void getCurrentWindow().destroy()}
<header data-tauri-drag-region>
```

#### Correct
```rust
// decorations only on Win/Linux, still hidden
#[cfg(any(windows, target_os = "linux"))]
{ let _ = window.set_decorations(false); }
let _ = window.show();
```
```tsx
onClick={() => void getCurrentWindow().close()}
<span data-tauri-drag-region className="select-none">{title}</span>
<div data-tauri-drag-region className="min-w-0 flex-1" />
```
