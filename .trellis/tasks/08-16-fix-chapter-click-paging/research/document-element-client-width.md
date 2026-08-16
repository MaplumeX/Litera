# Root `clientWidth` is the iframe viewport, not one page

## The wrong assumption from `08-14-fix-click-paging-hit`

`View.expand()` in `src/foliate-js/paginator.js` sets `document.documentElement.style.width` (or `height` when vertical) to one spread (`this.#size`). The previous task treated `document.documentElement.clientWidth` as that CSS width.

That is false for the root element.

CSSOM View, `Element.clientWidth` step 2: if the element is the **root** and the document is not in quirks mode, return the **viewport** width (scrollbar excluded). The specified CSS `width` on `<html>` is ignored.

In paginated mode the chapter iframe element is `pageCount * pageSize` wide, so the iframe viewport is the whole strip:

| Quantity | Actual value |
|---|---|
| `doc.defaultView.innerWidth` | iframe viewport = full strip |
| `doc.documentElement.clientWidth` | **same viewport** (root special case) |
| `html` CSS `width` / `getBoundingClientRect().width` / `offsetWidth` | one spread (`pageSize`) |
| `PointerEvent.clientX` inside the iframe | X from the left of the strip |

So this mapping is a no-op on long chapters:

```ts
pageLocalX(ev.clientX, doc.documentElement.clientWidth)
// === ev.clientX   because clientWidth === innerWidth === strip
```

`hitFromClientX` then compares strip-local X against the strip. Late pages of a long chapter all hit **right** (`goRight` / next). After `next()` crosses into the next section, a new iframe loads at page 1, the same screen click is now early in a new strip, and the whole page hits **left** (`goLeft` / prev).

One-page sections stay accidentally correct because strip width equals one spread.

## What to use instead

From inside the chapter document, without opening the paginator's closed shadow root:

- `doc.documentElement.getBoundingClientRect().width` — layout border box; matches the CSS `width` set to `pageSize`
- `doc.documentElement.offsetWidth` — integer layout width; also not special-cased for the root

Do **not** use `clientWidth` or `innerWidth` as the page width. Host gutter clicks stay on `foliate-view` `clientWidth` (that node is not a document root).

`pageLocalX` (positive modulo onto one spread) is still the right X mapping once the width is the layout width.

## Spec debt

`.trellis/spec/frontend/component-guidelines.md` currently states that `document.documentElement.clientWidth` is one spread. That sentence is wrong and should be corrected in Phase 3.3 of this task.
