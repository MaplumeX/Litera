# Library shelf UI pass

## Problem

The Library header packs about ten controls into the titlebar (search, status
filter, sort, direction, view, import, select, settings, trash, window
controls), and select mode swaps half of them out, so controls jump. The
persisted status filter hides inside a `Select`, so a reopened app can sit on a
narrowed shelf without saying so. Per-book actions are split: the hover ✕ makes
Delete the most prominent action, while the menus only offer Open / Details /
Delete, and star and Reading status live only on 10px inline controls.

## Decisions

- **Two rows.** The titlebar keeps only global actions: search (flexible
  width, clear button, `Ctrl/⌘+F` focuses, `Esc` clears), Import, Settings. A
  shelf toolbar below it holds everything about how the shelf is viewed, and is
  hidden while the Library is empty or loading.
- **Status tabs with facet counts.** The toolbar's left side shows
  All / Unread / Reading / Finished, then a divider, then Starred, each with a
  count. Counts are computed over the current search result (facet counts), so
  while searching they show which tab has hits. Narrow windows collapse the
  tabs into a `Select`.
- **Right side of the toolbar:** sort, direction, grid/list, Select, Trash.
  The Trash entry is always shown, with a count badge when non-empty, so its
  position is stable; an empty Trash opens the dialog's empty state.
- **Select mode only swaps the toolbar row** for a selection bar:
  count · Select all · Mark as ▾ · Star / Unstar · Delete · Cancel. `Esc` exits,
  `Ctrl/⌘+A` selects every visible Book. Batch curation keeps the selection;
  batch delete exits select mode as before.
- **One book menu.** The dropdown (⋯) and the context menu render the same
  items: Open · Reading status ▸ · Star/Unstar · Details… · Select · ─ · Delete….
  Continue reading cards get the menu too. The hover ✕ is removed; ⋯ takes its
  corner.
- **Status placeholder on hover only.** With Reading status in the menu, the
  inline "+ Status" placeholder is no longer the only entry point, so it only
  shows on hover / focus / while its menu is open. A set status and a set star
  stay visible.

- **Continue reading is a resume strip, not a second shelf.** It drops
  finished Books, renders as compact tiles (small cover, title, author,
  progress) in both grid and list views, and hides when it would only repeat
  the shelf: while searching, in select mode, and when the shelf itself is
  sorted by Recently opened, newest first (the default).
- **Quieter cards.** An unstarred star shows only on hover / focus; the
  "not downloaded" badge on a cover is an icon with a tooltip rather than a
  text label. Set stars, set statuses, and progress stay visible.

## Out of scope

- Card cover size control.
- Range selection with Shift-click.
