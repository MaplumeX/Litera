# foliate-js paginator iframe geometry

Source: `src/foliate-js/paginator.js` at submodule commit `78914ae` (`View.expand`, `Paginator.#scrollToPage`).

## What the iframe window actually is

Paginated mode (Litera's default; `flow` is not `scrolled`):

- Chapter HTML lives in a sandboxed iframe.
- CSS columns lay out the whole section at once.
- `View.expand()` then sizes the **iframe element** to `pageCount * pageSize` (a horizontal strip of every page).
- The wrapper around the iframe is two extra pages wider (`expandedSize + pageSize * 2`) so there is one blank page before and after the content.
- `#container` is `overflow: hidden` and moves with `scrollLeft` / `scrollTop` to show one spread.
- `document.documentElement` is explicitly set to **one page** (`style.width|height = pageSize`), with `box-sizing: border-box`.

Therefore:

| Quantity | Value |
|---|---|
| `doc.defaultView.innerWidth` | iframe viewport = **all pages** (`pageCount * pageSize`) |
| `doc.documentElement.clientWidth` | **one visible spread** (`pageSize`) |
| `PointerEvent.clientX` inside the iframe | X from the **left of the whole strip**, not the visible page |

`#scrollToPage(page)` uses `offset = size * page` (negated for RTL). First content page is page index 1 because of the leading blank.

## Why `innerWidth` hit-testing is wrong

`hitFromClientX(clientX, innerWidth)` compares a strip-local X against the strip width.

For a 10-page section:

- Early pages: visible `clientX` is still `< innerWidth / 3` → whole page looks like **left**
- Middle pages: visible `clientX` falls in the center third → **no turn**
- Late pages: visible `clientX` is `> innerWidth * 2 / 3` → whole page looks like **right**
- A 1-page section: `innerWidth === pageSize` → accidentally correct

Host-side binding (`clientX - hostRect.left` vs `host.clientWidth`) is unaffected. That path only sees paginator chrome / side gutters, not the chapter text.

## What not to do

- Do **not** only replace `innerWidth` with `documentElement.clientWidth` while still passing raw `clientX`. On page 2+, `clientX` is already `> pageWidth`, so the whole visible page becomes **right**.
- Do **not** map iframe clicks onto the `foliate-view` host width. The paginator grid keeps large empty side gutters; on a wide window the text column can sit entirely in the host's middle third.
- Do **not** query `#container` from the outside: `Paginator` uses a **closed** shadow root.
- Do **not** edit `src/foliate-js/`.

## Mapping that matches the visible page

Normalize iframe `clientX` into one page, then reuse `hitFromClientX`:

```
pageWidth = doc.documentElement.clientWidth   // one spread; not innerWidth
x = positiveMod(clientX, pageWidth)           // handle negative RTL remainders
zone = hitFromClientX(x, pageWidth)
```

`positiveMod(n, m) = ((n % m) + m) % m`.

This is spatial (left of the visible spread → `goLeft`). It does not depend on opening the closed shadow root.

Subpixel note: a click exactly on a column boundary can land at `pageWidth * i` and modulo to `0` (left). That is a 1px edge; do not add extra snap logic unless a test shows it.

Host / gutter clicks stay on the existing host-relative mapping.
