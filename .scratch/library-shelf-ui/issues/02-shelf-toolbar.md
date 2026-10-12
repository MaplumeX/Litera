# 02: Split the header into titlebar + shelf toolbar

**What to build:** See spec "Two rows", "Status tabs with facet counts", "Right side of the toolbar".

**Status:** resolved

- [x] Titlebar holds only search, Import, Settings (plus window controls); nothing in it changes in select mode
- [x] Search has a clear button; `Ctrl/⌘+F` focuses it; `Esc` in it clears it
- [x] Shelf toolbar below the titlebar, hidden while loading or when the Library is empty
- [x] Status tabs with counts over the current search result; Starred separated by a divider; active tab marked with `aria-pressed`; narrow windows show a `Select` instead
- [x] `countByStatus` pure function in `library-shelf.ts`, unit-tested
- [x] Trash entry always visible, with a count badge when non-empty
- [x] i18n keys in both locales

## Comments

- Toolbar and selection bar live in `LibraryShelfToolbar.tsx`; `LibraryView` keeps state and IPC. Tabs are `aria-pressed` buttons in a labelled group, and the narrow-window `Select` is the same choice behind `md:hidden` (both are in the DOM; CSS picks one).
- Search Escape reads `e.currentTarget.value` rather than the `search` state so it is correct before the re-render lands.
