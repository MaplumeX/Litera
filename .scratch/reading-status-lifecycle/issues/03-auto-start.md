# 03: Auto-start on the first page turn

**What to build:** Turning the first page after opening an `unread` or `paused` Book makes it `reading`.

**Blocked by:** 02

**Status:** resolved

- [x] Rust command `mark_book_started(bookId)`: `unread`/`paused` → `reading`, bumps `statusUpdatedAt`; no-op otherwise; returns the record
- [x] `App.tsx` calls it once per open, on the first relocate that moves away from the position-restoring one (via `useReadingStatus`)
- [x] The shelf reflects the new status when the reader returns to the Library
- [x] Tests: Rust per starting status; frontend that opening alone does not call it and the first turn calls it once
