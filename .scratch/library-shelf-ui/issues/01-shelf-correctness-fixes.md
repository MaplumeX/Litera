# 01: Shelf correctness fixes

**What to build:** No empty-state flash before the first `list_books`, aligned list-view columns when some rows are not downloaded, and an empty result that names the active status filter and offers Clear filters.

**Status:** resolved

- [x] Empty state renders only after the first load settles; a failed first load shows only the error banner
- [x] `BookListRow` reserves the "not downloaded" column on every visible row when any visible row needs it
- [x] Empty result names a non-`all` status filter and offers a Clear filters button that resets search and the persisted filter
- [x] Tests in `LibraryView.test.tsx`; CHANGELOG entries
