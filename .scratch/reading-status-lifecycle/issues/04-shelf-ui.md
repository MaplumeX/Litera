# 04: Shelf UI for the four statuses

**What to build:** The shelf, menus, and Continue reading speak the new model: four statuses, no unset, an On hold tab, and Continue reading = Reading.

**Blocked by:** 02

**Status:** resolved

- [x] `LibraryStatusFilter` gains `paused`; tabs All / Unread / Reading / On hold / Finished | Starred with counts; narrow-window `Select` likewise
- [x] `BookStatusMenu`, the book menu submenu, and batch Mark as offer four statuses, no unset; `BookStatusChoice` collapses into `ReadingStatus`
- [x] Dashed "+ Status" placeholder removed; decide in review whether `unread` shows only on hover
- [x] `takeRecent` returns only `reading` Books
- [x] i18n: add `paused` (On hold / 搁置), remove `unset` / `add`, key sets identical
- [x] Tests in `library-shelf.test.ts` and `LibraryView.test.tsx`; CHANGELOG entry
