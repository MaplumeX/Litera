# foliate-js paging event model

Source: foliate-js `view.js` / `paginator.js` at submodule commit `78914ae` (also verified against upstream `master` on 2026-08-13).

## What the library actually does

- `View.prev()` / `View.next()` forward to `renderer.prev/next`.
- `View.goLeft()` / `View.goRight()` honor `book.dir === 'rtl'`.
- `View.init({})` with no `lastLocation` calls `next()` to reach the first linear section.
- Click on chapter documents: only `<a href>` is handled. No page-edge click.
- `Paginator` listens for touch swipe + snap. No `wheel` listener.
- Paginated flow: `#container` is `overflow: hidden`. Wheel does not native-scroll a page.
- Scrolled flow (`flow="scrolled"`) is `overflow: auto`. Litera does not set this attribute, so default is paginated columns.
- Chapter HTML lives in a sandboxed iframe (`allow-same-origin allow-scripts`). Parent `window` does not receive iframe `keydown` / `click` / `wheel`.
- Each section load emits `load` on `foliate-view` with `{ doc, index }`. Listeners must be attached per `doc` and cleaned up when the view unmounts (docs are discarded on section change).
- `Paginator.#locked` blocks overlapping turns; after a section change it waits 100ms.

## What Litera must not do

- Do not edit `src/foliate-js/` (git submodule).
- Do not set `flow="scrolled"` just to get wheel scrolling; that changes the reading model.
- Do not cover the iframe with a full-height 1/3 overlay: it blocks text selection in that third.

## Host-side implication

Attach click / key / wheel on:

1. Each iframe `doc` via the `load` event (content area).
2. The host `foliate-view` / ReaderView container (paginator margins).
3. Parent `window` keydown only as a fallback when the iframe is not focused.

Distinguish click vs drag/selection before turning the page.
