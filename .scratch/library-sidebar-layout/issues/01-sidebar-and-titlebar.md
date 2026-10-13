# 01: Left sidebar and centered-search titlebar

**What to build:** See spec "Left sidebar" and "Titlebar".

**Status:** resolved

- [x] `LibrarySidebar` component: filter items with facet counts (zero renders muted `·`), divider before Starred, active item `aria-current="page"`
- [x] Sidebar bottom: Import books (ghost, disabled while busy, "Importing…" label while importing) and Trash with count when non-empty
- [x] Sidebar shown once loaded, including an empty Library; hidden only before the first `list_books` settles
- [x] Titlebar: Litera on the left, search centered with a `Ctrl/⌘ F` hint while empty and unfocused, Settings and window controls on the right; Import removed from the titlebar
- [x] Status tabs removed from `LibraryShelfToolbar`
- [x] `LibraryView.test.tsx` updated: filter by sidebar item, Trash reachable with an empty Library, Import from sidebar
- [x] i18n keys in both locales

## Comments

- `LibrarySidebar.tsx` owns the filter list and the Import / Trash footer; `LibraryView` still holds state and IPC. Filter items use `aria-current="page"`; a zero count is a `·` with an sr-only `0`, so names stay "未读 0" for assistive tech and tests.
- The titlebar's left and right groups are `flex-1 basis-0`, which keeps search visually centered; the `Ctrl F` hint is CSS-only (`peer-focus:hidden`, rendered while search is empty).
