# Readest wheel-to-page gesture

Source: Readest `apps/readest-app/src/app/reader/utils/wheelGesture.ts` (fetched 2026-08-13 from `readest/readest` main). Closest analog: Tauri + foliate-js.

## Why not raw wheel events

Paginated mode maps wheel to `prev` / `next`. Magic Mouse / macOS trackpad emit a long stream of tiny pixel deltas plus an inertial tail. Unfiltered, one physical gesture turns many pages.

## Detector

`createWheelGestureDetector()`:

1. If `timeStamp - lastTime > idleResetMs` (default **200**): reset accumulators and `flipped`.
2. Update `lastTime`.
3. If already `flipped` for this gesture: return null (swallow momentum).
4. Add normalized `deltaX` / `deltaY`.
5. If both axes `< threshold` (default **30**): no flip.
6. Else set `flipped`, clear accumulators, return the dominant axis.

Normalize: `deltaMode === 1` → `delta * 40`; `deltaMode === 2` → `delta * 800`; else pixels.

Ctrl/pinch is handled outside the detector (reset + zoom).

## Contrast with Foliate GTK (not this task)

Foliate distinguishes discrete mouse-wheel (100ms debounce → `prev`/`next`) vs continuous trackpad (`reader.scrollBy` then `snap` on scroll-end). That is 1:1 follow. Out of scope here.

## Contrast with current Litera

Litera uses threshold **80** and a **280ms** cooldown that **extends on every event** during cooldown. Inertia keeps the lock alive until the tail dies, then another 280ms. It also ignores `deltaMode`, so line-mode notches (delta 1–3) never reach the threshold.
