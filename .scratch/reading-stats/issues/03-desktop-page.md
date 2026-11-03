# 03: Desktop Reading stats page

**What to build:** A Reading stats item in the Library sidebar opens the page described in the spec in the shelf pane.

**Blocked by:** 02

**Status:** resolved

- [x] `LibrarySidebar` item above Trash; it swaps the shelf pane in `LibraryView`, keeps the sidebar and shows as selected
- [x] Week / Month / Year switch with ‹ › navigation
- [x] Stat tiles: time with change, days with streak, daily average, finished
- [x] 52-week heatmap; picking a day shows that day's Books
- [x] Time bars, by day for week and month, by month for year
- [x] Books ranked by time; clicking one opens it; a deleted Book shows its title snapshot, no cover, and does not open
- [x] Empty states for no data yet and recording off
- [x] Hand-written SVG/CSS with `--chart-*` and `Tip`, no new dependency; read the `dataviz` skill first
- [x] Chart values are reachable by keyboard; light and dark themes both checked; motion respects `motion-reduce`
- [x] Copy in en and zh-CN
- [x] Component tests per the spec; checked in the real app

## Comments

- The heatmap shows values in a readout line under it rather than one `Tip` per cell: 364 tooltips for one readout, and the readout works by keyboard too. The time bars use `Tip`.
- `--stats-mark` is a new token: `--chart-1` in light; `#d27c0e` in dark, since the theme's dark `--chart-1` is a dark blue that changes the hue between themes. Both pass the `dataviz` validator's lightness and contrast checks.
- Heatmap levels are fixed minutes (15, 30, 60), so a day looks the same whatever else was read.
- The period switch and arrows do not move the heatmap: it is always the past year.
- Checked in the real desktop app under WSLg, with a temp data directory and a seeded log: light and dark, en and zh-CN, 1100px and 800px wide, Week / Month / Year, picking a day, opening a Book from the ranking and going back.
- Not checked in the real app: real pointer hover on the bars' `Tip`, and the deleted Book row (covered by a component test).
- Opening a Book from the page and going back lands on the shelf, not the page, because `LibraryView` unmounts while reading.
