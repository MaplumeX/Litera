# Titlebar drag vs double-click maximize

## Current Litera wiring

`onTitlebarDragMouseDown` (`src/components/WindowControls.tsx`) only calls `toggleMaximize()` when `buttons === 1` and `detail === 2`. The same title and spacer nodes also have `data-tauri-drag-region`.

`data-tauri-drag-region` starts a native window drag on the first `mousedown`. That is why double-click is intermittent: a few pixels of movement between clicks drops `detail` back to 1, or maximize races the in-flight drag.

`preventDefault()` on the second down cannot cancel a drag that already started. Native drag is not a DOM default action.

## Upstream

- [tauri#11945](https://github.com/tauri-apps/tauri/issues/11945): double-click `data-tauri-drag-region` to restore a maximized undecorated window changes maximized state but leaves size/position fullscreen.
- [wry#622](https://github.com/tauri-apps/wry/issues/622) / [tauri#3220](https://github.com/tauri-apps/tauri/issues/3220): double-click drag-region to toggle maximize is incorrect without decorations.

Tauri docs (`v2.tauri.app/learn/window-customization`) treat the attribute and a manual `startDragging()` listener as alternatives. Mixing them on the same node is the bug.

## Chosen approach

Do not wait a double-click timeout before dragging (lag + `startDragging()` may lose the user-gesture context).

Remove the attribute. On primary `pointerdown` with `detail >= 2`, `toggleMaximize()`. On primary `pointerdown` with `detail < 2`, wait for pointer movement past 4px, then `startDragging()` once.

`core:window:allow-start-dragging` is already granted.

## Out of this research

Window-edge Aero snap (double-click the outer resize border) is not implemented in the app and is not required for this fix.
