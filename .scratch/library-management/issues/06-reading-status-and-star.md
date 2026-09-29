# 06: Reading status and star

**What to build:** A Book gains a reading status (unread / reading / finished) and a star, editable from the shelf and the details dialog, filterable in the header, and synced across devices.

**Blocked by:** 04 (`bookUpdatedAt`, without which a status change has no timestamp to sync on).

**Status:** ready-for-agent

- [x] `BookRecord` (`library.rs` + `src/types/library.ts`) gains `readingStatus?: "unread" | "reading" | "finished"` and `starred?: boolean`, both optional with defaults, so existing `library.json` files parse unchanged
- [x] Unset status is distinct from `"unread"` (absent means the reader has not curated the book; `"unread"` is an explicit choice) — no field is derived from `lastFraction`
- [x] A Rust command updates both fields (`update_book_curation` or equivalent), validates `readingStatus` against the allowed set, keeps `starred` optional so a status-only write cannot clear a star, and bumps `BookRecord::updatedAt`
- [x] `SyncBookMetadata` gains `reading_status` / `starred` and the values round-trip through `export_local_manifest` and the merged-manifest apply; a metadata-only change made locally wins by `bookUpdatedAt` after the round trip
- [x] `CONTEXT.md` gains glossary entries for **Reading status** and **Starred**, and the **Book** entry mentions them
- [x] `src/lib/library-shelf.ts` gains a status filter predicate over All / Unread / Reading / Finished / Starred; filtering composes with search and sorting without changing either
- [x] `LibraryView.tsx` shows a status `Select` in the header next to Sort (only when the shelf is non-empty), with the filter persisted in localStorage alongside the existing view/sort preferences and loaded defensively
- [x] `BookCard` and `BookListRow` show the star (filled/outline) and allow toggling it in place without opening the book or the details dialog; the star control is keyboard-reachable and carries an `aria-pressed`
- [x] Status renders on the card/row (a subtle badge or label) so the filter's effect is visible; it does not compete visually with the progress indicator
- [x] Reading status is set from a `BookStatusMenu` on `BookCard` and `BookListRow` (one shared component; the shelf injects the IPC callback), and a book with no status still renders a dimmed placeholder trigger because this is the only entry point
- [x] `BookDetailsDialog` does **not** carry the status field: the metadata write path replaces every text field, and keeping curation on the shelf avoids two places that can set it
- [x] New i18n keys in **both** `src/locales/en.ts` and `src/locales/zh-CN.ts` (status filter labels, the three statuses, star on/off labels), key sets identical
- [x] `src/lib/library-shelf.test.ts` covers the filter predicate for each option, including combining it with a search query
- [x] `src/components/LibraryView.test.tsx` asserts starring a card invokes the command with the right payload and that the status filter narrows the rendered cards
- [x] `src/lib/sync-merge.test.ts` covers status/star surviving a merge, and a status change on one device plus a title edit on the other resolving per the documented `bookUpdatedAt` rule

## Comments

- The details dialog currently saves through `update_book_metadata`, which replaces all six text fields at once; a status write must not go through that path or it will rewrite title/author/etc. with form values while the user only meant to toggle a status.
- Star is a curation signal, not a sort key: it drives a filter, not a new `LibrarySortKey`.

- Rust: `update_book_curation(bookId, readingStatus, starred)` treats `None` as "leave alone", so a status-only write cannot clear a star, and an empty `readingStatus` clears the status. Invalid values are rejected with `InvalidInput`. The single `updatedAt` rules and validation are covered by `curation_updates_only_the_fields_it_is_given`.
- The command does not go through `update_book_metadata`: that path replaces every text field from the dialog's form state, so a star toggled on a card would rewrite (or blank) title/author on the next details save.
- `BookCard`/`BookListRow` render the star as a sibling of the row's clickable area rather than inside it: the list row's whole body is a `<button>`, and nesting one button inside another is invalid HTML. The card's title block is not a button, so its star sits with the title.
- The status filter is a `Select` next to Sort, persisted under `litera.libraryStatusFilter`. `filterByStatus` is applied between `filterBooks` and `sortBooks`, so search, status, and ordering compose without any of them changing the others' meaning. The **Continue reading** row is filtered too (it reads `takeRecent(filterByStatus(books, statusFilter))`); a reader looking at "unread" should not see finished books pinned at the top of the shelf.
- Test hygiene, second instance: `LibraryView.test.tsx` also had to clear `litera.libraryStatusFilter` between tests — the status-filter test was leaving `finished` behind, which made the next test open with that filter already applied.
- "Absent" status is preserved as distinct from `unread` end to end (Rust `Option`, TS `undefined`, the dialog's sentinel `"none"` option); an absent status is never matched by the `unread` filter. This is asserted on both sides.
- `CONTEXT.md` gained **Reading status**, **Starred**, and **Trash** entries, and the **Book** entry now mentions curation.
- Known limitation, per the spec: metadata still merges as one object behind a single timestamp, so concurrent curation on one device and a title edit on the other resolve last-writer-wins rather than both surviving. `sync-merge.test.ts` documents that outcome explicitly so the behaviour is intentional rather than surprising.
- Tests: `filterByStatus`/`isLibraryStatusFilter` unit cases, status-filter prefs round trip, card star IPC payload, the filter narrowing rendered cards, and Rust curation/validation/export/apply cases. `cargo test`: 245 passed. Full frontend suite: 823 passed; `tsc --noEmit` clean.

## Comments (review fixes)

- **Curation moved fully onto the shelf.** The details-dialog status field was removed on the maintainer's call: the menu on `BookCard` / `BookListRow` (one `BookStatusMenu` component, IPC injected by `LibraryView`) is now the single entry point, and a book with no status renders a dimmed placeholder trigger so that entry point is never invisible. The dialog no longer calls `update_book_curation` at all. Spec User Story 22 and the UI-surfaces decision were updated to match.

- The checklist asked for the filter predicate "including combining it with a search query"; that case was missing and is now covered (`filterByStatus(filterBooks(...))`).
- Reviving the metadata-ordering and curation cases in `sync-merge.test.ts` to assert commutativity in **both** merge orders, as the spec's Testing Decisions require (previously only the revival case was asserted both ways).
