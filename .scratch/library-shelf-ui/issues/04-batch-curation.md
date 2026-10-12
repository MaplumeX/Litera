# 04: Selection bar with batch curation

**What to build:** See spec "Select mode only swaps the toolbar row".

**Blocked by:** 02

**Status:** resolved

- [x] In select mode the toolbar row becomes: count · Select all · Mark as ▾ · Star/Unstar · Delete · Cancel
- [x] Star sets `starred: true` on every selected Book unless all are already starred, in which case it unstars them all
- [x] Mark as applies one Reading status (or unset) to every selected Book via `update_book_curation`, leaving stars alone
- [x] Failures are reported in one notice listing titles; the selection is kept
- [x] `Esc` exits select mode; `Ctrl/⌘+A` selects every visible Book (not while typing in an input)

## Comments

- Single-book and batch curation share `updateCuration` in `LibraryView`: one `update_book_curation` per book, one `setBooks` merge, one notice (the single-book message for one target, a title list for a batch).
- Shelf shortcuts ignore keystrokes while a dialog, menu, or listbox is open, and Escape / select-all ignore text inputs.
