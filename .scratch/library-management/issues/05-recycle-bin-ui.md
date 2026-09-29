# 05: Recycle bin UI

**What to build:** The recovery window ticket 03 built becomes reachable. A "Recently deleted" surface lists trash entries with cover, title, deletion time, size, and where the deletion came from; the reader can Restore (local deletions only) or delete permanently, and the shelf's delete confirmation stops claiming the action is irreversible.

**Blocked by:** 03 (trash commands), 04 (revival semantics, so Restore survives Sync).

**Status:** ready-for-agent

- [x] A "Recently deleted" entry point in `src/components/LibraryView.tsx`'s header, shown only when the trash is non-empty (count off the initial load, refreshed on `litera:sync-applied` like the shelf)
- [x] Opening it lists entries from `list_trashed_books` newest-first, each showing cover (with the same initial-letter fallback as `BookCoverImage`), title, author, deleted-at (via `formatLibraryTimestamp`), human-readable size, and a Sessions marker
- [x] `origin: "sync"` entries render their reason ("deleted on another device") and offer **no** Restore button — only permanent delete
- [x] `origin: "local"` entries offer Restore and permanent delete; permanent delete asks for confirmation first (reuse the existing `AlertDialog`/confirm pattern, not a new dialog system)
- [x] Restore invokes `restore_trashed_book`, closes/refreshes the trash list, refreshes the shelf, and notifies Sync activity (`notifySyncActivity`) so the revival reaches the backend
- [x] A "Delete all permanently" action exists, confirms, and invokes `purge_all_trashed_books`
- [x] Failures surface as a dismissible notice (reuse the `BookImportNotices`/`pushNotice` pattern) naming the book, never as an unhandled rejection
- [x] The shelf's delete confirmation copy in `src/locales/en.ts` (`library.deleteDescOne` / `library.deleteDescMany`) and `src/locales/zh-CN.ts` states that the book and its chats go to the trash and can be restored — the current "This cannot be undone" is now false
- [x] Empty trash state has its own copy (not the shelf's "No books yet")
- [x] New i18n keys in **both** locale files, key sets identical
- [x] `src/components/LibraryView.test.tsx` asserts the IPC calls and the rendered list: opening the trash calls `list_trashed_books`; Restore calls `restore_trashed_book` with the right ids and refreshes the shelf; a sync-origin entry has no Restore control; the delete confirmation text no longer contains the irreversibility claim

## Comments

- Prefer a dialog over a separate route: the shelf is a single view today and a full Trash page would need routing the app does not have. Keep it a focused `Dialog` opened from the header.
- The trash is local-only and never synced (`CONTEXT.md`, ADR 0001); nothing here should write to the Manifest except the Tombstone revocation already done by the Rust restore command.

- `src/components/TrashDialog.tsx` is presentational: `LibraryView` owns the entries, the IPC calls, and the refresh, so the component tests drive everything through the real header button and assert the `invoke` calls.
- The entry point is an icon button (sized like the Settings button) carrying `aria-label` and `data-trash-count`, rather than a labelled button: the header already holds search, sort, view, direction, Select, Import, and Settings, and a sixth text button does not fit.
- The Trash is refreshed on mount and on `litera:sync-applied`, and after every delete/restore/purge, so the count never goes stale.
- A `list_trashed_books` failure is logged and swallowed: the Trash is a recovery affordance, and a broken trash must not take the shelf down with it.
- `formatByteSize` (new `src/lib/trash.ts`) is unit-tested separately; it clamps non-finite/negative input and disables digit grouping so sizes read like file managers ("1023 B", "1.4 GB").
- Test hygiene fix: `LibraryView.test.tsx` now resets the locale in `beforeEach`. An existing test switches to `en` and was leaking into later tests, which is why the new Chinese-labelled assertions failed only in a full run and passed alone.
- Delete-confirmation copy in both locales updated; the two existing tests that pinned the old "cannot be undone" string were updated with it, which is also the assertion that the UI no longer claims irreversibility.
- Full frontend suite: 811 passed; `tsc --noEmit` clean.

## Comments (review fixes)

- Restore and permanent-delete failures now name the book (`恢复「{title}」失败` / `Failed to restore “{title}”`); emptying the trash has its own message rather than reusing the single-entry one.
- The 回收站 naming conflict with `CONTEXT.md`'s Trash entry was resolved in the glossary rather than the copy: `Recycle bin` was dropped from the entry's `_Avoid_` list (it is the Chinese name for this concept, not a synonym to avoid) and the entry now records that the English UI says "Recently deleted" while the Chinese UI says 回收站. Session copy followed the glossary instead: 对话 became 会话 and "chats" became "Sessions" in the strings this ticket touched.
