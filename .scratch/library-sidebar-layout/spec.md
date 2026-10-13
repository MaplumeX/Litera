# Library sidebar layout

Supersedes the "Two rows", "Status tabs with facet counts" and "Right side of
the toolbar" decisions in `.scratch/library-shelf-ui/spec.md`. Everything else
there (one book menu, batch curation, facet counts) still holds.

## Problem

The two-row header puts every control in two horizontal strips and none of
them reads as more important than another:

- The solid primary Import button is the brightest thing on screen, brighter
  than the covers, for an action used rarely.
- Search, the most frequent action, sits pushed against the window controls
  with an empty drag area to its left.
- The toolbar's right side mixes a borderless sort `Select` whose label and
  chevron float apart (fixed `w-[8.75rem]`), a separate direction icon, two
  loose view icons, a text "Select" button and a Trash icon. Rare actions
  (Trash) take the most prominent end slot.
- Six status tabs crowd one row, and zero counts ("Unread 0", "Starred 0")
  are as loud as real ones.
- On the cards, a "Reading" chip under almost every book and a `%` badge on
  every cover repeat what the progress bar already says.
- When the Library is empty the toolbar hides, so the Trash is unreachable
  right after deleting the last Book.

## Decisions

- **Left sidebar** holds the shelf's navigation:
  - Filters, top: All / Unread / Reading / Paused / Finished, a divider,
    Starred. Each with its facet count (over the current search result, as
    before), right-aligned, `tabular-nums`. A zero count renders muted as
    `·` rather than `0`; the item stays so positions never shift. The active
    item is marked with `aria-current` and a filled background.
  - Bottom, pinned: Import books (ghost style, `+` icon) and Trash (with count
    when non-empty). Import is no longer a primary-variant button anywhere on
    the shelf except the empty state.
  - Shown once the first `list_books` settles, including when the Library is
    empty, so the Trash stays reachable.
- **Titlebar** keeps only: sidebar toggle + "Litera" on the left, search
  centered in the titlebar (fixed max width, `Ctrl/⌘ F` hint shown inside the
  field while empty and unfocused), Settings, window controls. The drag area
  is whatever space is left on both sides of search. Search keeps its clear
  button, `Ctrl/⌘+F` focus and `Esc` clear.
- **Collapsing.** The titlebar toggle collapses the sidebar (persisted). Below
  the `md` breakpoint the sidebar is collapsed by default and the toggle opens
  it as an overlay drawer that closes on a choice, `Esc`, or outside click.
  The narrow-window status `Select` goes away.
- **Content header** replaces the shelf toolbar, inside the content column,
  scrolling with nothing (sticky at the top of the scroll area):
  - Left: the current filter's name and count, e.g. "Reading · 19"; while
    searching, the result count for the query instead.
  - Right: one sort dropdown whose trigger reads "<key> ↓/↑" and whose menu
    holds the keys as radio items, a separator, then Ascending / Descending
    as radio items. Picking a key still resets to its natural direction.
    Then a grid/list segmented control (one bordered group, active segment
    filled).
  - No "Select" button. Select mode is entered from the book menu's Select
    item (exists) or by `Ctrl/⌘`-click on a card or row. In select mode the
    selection bar replaces the content header row in place; the sidebar and
    titlebar do not change.
- **Quieter cards.**
  - The inline status chip shows only for Paused and Finished. Unread and
    Reading are hover/focus/menu-open only (Reading is already carried by the
    progress bar). It is also hidden when the active filter is that status.
  - The cover `%` badge shows only on hover/focus; the thin progress bar at
    the cover's bottom stays.
- **Continue reading is a cover strip.** A single non-wrapping, horizontally
  scrollable row of covers (about 96px wide, the shelf's cover ratio), each
  with a one-line title and a progress bar with percent beneath. No card
  border or background. Show/hide rules from the previous spec are unchanged.

## Out of scope

- Fixed column widths / max content width for the grid.
- Generated covers for books without a cover image.
- Drag-over overlay for drop import, loading skeleton, list-view column
  headers, serif title type.
