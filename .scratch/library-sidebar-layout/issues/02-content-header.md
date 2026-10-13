# 02: Content header with merged sort and segmented view

**What to build:** See spec "Content header". Replaces the rest of `LibraryShelfToolbar`.

**Status:** resolved

**Blocked by:** 01

- [x] Sticky header at the top of the scroll area: "<filter> · <count>", or the search result count while searching
- [x] One sort dropdown: key radio items, separator, Ascending / Descending radio items; trigger shows key and direction arrow; picking a key resets to `naturalOrderFor`
- [x] Grid/list as a segmented control (`aria-pressed` per segment)
- [x] "Select" button and Trash removed from the header
- [x] `Ctrl/⌘`-click on a card or list row enters select mode with that Book selected (or toggles it when already in select mode)
- [x] Selection bar renders in the header's place; sidebar and titlebar unchanged in select mode
- [x] Tests: sort direction via the dropdown, `Ctrl`-click enters select mode

## Comments

- `LibraryShelfToolbar` is now the shelf header (filter name · count, sort menu, view segments); `LibrarySelectionBar` replaces it in place. The sort trigger carries `data-sort-order`; tests drive it through a `pickSortItem` helper.
- Tests that used the removed Select button now enter select mode with Ctrl-click, so they start at "已选 1".
