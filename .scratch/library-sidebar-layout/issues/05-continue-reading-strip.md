# 05: Continue reading as a cover strip

**What to build:** See spec "Continue reading is a cover strip".

**Status:** resolved

- [x] `BookResumeTile` becomes a cover-first tile (~96px cover, one-line title, progress bar + percent), no card border or background
- [x] One non-wrapping, horizontally scrollable row; keyboard focus scrolls the tile into view
- [x] Book menu (dropdown on hover + context menu) kept on tiles
- [x] Show/hide rules unchanged

## Comments

- No custom scroll-into-view: the browser already scrolls a focused tile into view inside the `overflow-x-auto` row.
