# Design: remove native window shell

## Approach

Keep one main window. Change its chrome by platform, then fold drag + window controls into the existing library and reader headers.

Window starts `visible: false` already. Apply platform chrome in Rust `setup` **before** the existing `show()` / `set_focus()`, so the native title bar never flashes.

- macOS: `TitleBarStyle::Overlay` + hide title text. Leave `decorations` on so traffic lights stay native.
- Windows / Linux: `set_decorations(false)`.

Frontend: one `WindowControls` on the right of both headers (hidden on macOS). Title text and a flex spacer are `data-tauri-drag-region`. Buttons, search, and window controls are not.

## Boundaries

| Layer | Change |
|---|---|
| `src-tauri/src/lib.rs` | Before `show()`, set Overlay + hidden title on macOS; `set_decorations(false)` elsewhere. |
| `src-tauri/capabilities/default.json` | Grant start-dragging, minimize, toggle-maximize, close. Keep `allow-destroy` (existing close-flush path). |
| `src/lib/platform.ts` | Detect desktop OS from `navigator.userAgent`. No new OS plugin. |
| `src/components/WindowControls.tsx` | Win/Linux min / max / close. Close calls `close()`, never `destroy()`. |
| `LibraryView.tsx` / `App.tsx` headers | Same height; macOS left inset for traffic lights; drag regions; mount `WindowControls`. |
| `src/locales/*` | aria-labels for the three buttons. |
| `tauri.conf.json` | No `decorations: false` in the shared file (would drop Mac traffic lights). |

Do not add `@tauri-apps/plugin-os`. Do not write window chrome into `preferences.json`. Do not add a second titlebar row.

## Contracts

### Window chrome (Rust, before show)

```rust
if let Some(window) = app.get_webview_window("main") {
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
        let _ = window.set_title("");
        // If the Tauri version exposes it, set traffic light origin so
        // the lights sit in the 48px header: about (16, 16).
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_decorations(false);
    }
    let _ = window.show();
    let _ = window.set_focus();
}
```

If `set_title_bar_style` cannot be applied after create, fall back to a complete `tauri.macos.conf.json` `windows[0]` copy (platform array merge may replace, so do not send a partial windows array). Do not put `decorations: false` in the shared `tauri.conf.json`.

### Capabilities

Add to `src-tauri/capabilities/default.json` (keep existing entries):

- `core:window:allow-start-dragging`
- `core:window:allow-minimize`
- `core:window:allow-toggle-maximize`
- `core:window:allow-close`

`core:window:allow-destroy` stays. The existing `onCloseRequested` handler still `preventDefault` + flush + `destroy()`.

### Frontend close

`WindowControls` close must call `getCurrentWindow().close()`. That raises `CloseRequested` and reuses the flush path. Calling `destroy()` from the button would skip flush.

### Platform detection

```ts
export type DesktopOs = "macos" | "windows" | "linux" | "unknown";

export function detectDesktopOs(userAgent = navigator.userAgent): DesktopOs
export function usesCustomWindowControls(os = detectDesktopOs()): boolean
// true when os is windows | linux | unknown (tests / browser)
```

macOS UA contains `Mac`. Do not treat iPad as a product target.

### Header layout

Both headers: `h-12 shrink-0`. macOS: extra left padding (~72px) so title / back are not under the traffic lights. Win/Linux: keep current horizontal padding.

Structure (shared idea):

```
[optional mac inset] [back?] [title drag] [flex spacer drag] [actions] [WindowControls?]
```

`data-tauri-drag-region` only on the title node and the spacer. Not on the header root (children would inherit clicks into buttons unless every child is opted out; Tauri only honors the attribute on the marked element, not descendants).

Double-click maximize: `data-tauri-drag-region` does not do this. On the drag nodes, `mousedown` with `buttons === 1` and `detail === 2` → `toggleMaximize()`; otherwise rely on the attribute for drag. Do not call `startDragging()` on the same click that toggles maximize.

Window buttons: existing `Button` `size="icon-sm"` `variant="ghost"` + lucide icons (`Minus`, `Square` / restore, `X`). Close hover may use destructive tint. All three need `aria-label` from `useT()`.

## Data flow

```
launch (visible:false)
  → setup applies Overlay or decorations:false
  → window-state restores SIZE/POSITION/MAXIMIZED
  → show + focus

drag blank header → start-dragging
double-click blank header → toggle-maximize
Win/Linux minimize / maximize buttons → minimize / toggleMaximize
any close path → CloseRequested → flush ≤2s → destroy
quit → window-state writes .window-state.json
```

File-drop on the library is unchanged (`onDragDropEvent`).

## Compatibility

- window-state flags stay `SIZE | POSITION | MAXIMIZED`. No `VISIBLE`, no `FULLSCREEN`.
- `visible: false` + app `show()` stays; chrome must be applied before `show()`.
- Existing `onCloseRequested` mock in `App.annotations.test.tsx` must also mock `close` / `minimize` / `toggleMaximize` if those tests mount the new controls (library is mocked there; reader header is real).
- Library drag-drop mock is independent of window drag.

## Tradeoffs

| Choice | Why |
|---|---|
| Setup-time API vs shared `decorations: false` | Shared false would remove Mac traffic lights. Setup-time keeps one `tauri.conf.json` and runs while hidden. |
| UA detect vs OS plugin | Avoids a new plugin and capability. UA is enough for chrome visibility. |
| Merge into existing headers vs extra titlebar | Product decision: no second row, reading height stays. |
| `close()` vs `destroy()` on the button | `close()` hits the existing flush handler. |
| No Snap Layout | Out of scope; needs extra Windows APIs. |

## Rollback

Revert `lib.rs` setup chrome, capability additions, the new component/helper, header markup, and locale keys. No data-file migration.
