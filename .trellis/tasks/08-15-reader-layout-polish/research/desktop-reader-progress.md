# Desktop reader progress patterns

Researched 2026-08-15 for `08-15-reader-layout-polish`.

## What other apps do

| App | Bar location | Jump UI | Paging |
|---|---|---|---|
| Foliate | Bottom nav | Native range slider + `getSectionFractions()` tick marks (spine section starts) | Click page edges, arrows |
| Readest | Bottom toolbar; optional always-on bar | Tick at each chapter boundary; `Alt+←/→` prev/next chapter | Click edges, arrows, wheel |
| Kindle | Bottom | Chapter ticks, larger thumb while dragging, location preview | Click / keys |
| Apple Books / 微信读书 | Bottom | Visible thumb; destination chapter while dragging | Click / swipe / keys |

Consensus: the bar is for **coarse jumps**. Page turning stays on the page (click zones, keys, wheel). Mid-grain navigation is **previous / next chapter**, not previous / next page.

## Foliate API already in this repo

`src/foliate-js/view.js` `getSectionFractions()` returns spine-section starts as `0–1` fractions (`sectionProgress.sectionFractions` plus `Number.EPSILON`). Foliate's own `reader.js` paints those as `<datalist>` tick marks and seeks with `goToFraction` on slider `input`.

That is section boundaries, not TOC headings. Good enough for ticks. Prev/next **chapter** should walk the flattened `book.toc` by `href`, which is what the reader already uses as `chapterHref`.

## Preview without live-seeking

Foliate seeks on every slider `input`. Litera's current bar also seeks on pointerdown/move, and `goToFraction` can lag the pointer.

Desktop sliders that feel precise: the thumb and fill follow the pointer immediately; the book jumps on **click** or **pointerup**. Preview copy is `{chapter} · {pct}%` when a chapter label is known, otherwise just the percent.

## Do not copy

- Hover-only / tap-to-reveal bars (mobile immersive; rejected for this desktop app)
- Footer page numbers or remaining-time (EPUB page lists are unreliable; existing spec already excludes them)
- Previous / next **page** buttons (removed earlier; they duplicate click / keys / wheel)
