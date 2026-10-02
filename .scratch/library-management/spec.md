# Spec: Library management — recovery, findability, and curation

Status: ready-for-agent

## Problem Statement

The Library has the mechanics of a shelf — import, search, sort, grid/list, bulk
delete, metadata editing — but not the affordances of a *managed* one. Four gaps
stand out:

1. **Deleting a book is a one-way door.** `delete_book` moves the book directory
   into `books/.trash/` (a recovery window the Rust layer already documents) and
   then irreversibly deletes the book's Sessions via `remove_book_sessions`. The
   confirmation dialog even says "This cannot be undone", which is both
   discouraging and, for the book directory, untrue. There is no way for a user
   to reach that recovery window, no retention policy for it, and a mis-click
   costs an entire assistant conversation history.

2. **Search only looks at two fields.** `filterBooks` matches `title` and
   `author`, while `BookRecord` already carries `series`, `publisher`,
   `language`, and `description`. A reader with 300 books organized by series
   cannot find "the Penguin edition" or "the book I tagged with a publisher".

3. **Sorting and the list view are half-built.** Every sort key is fixed to one
   direction; the list view shows title, author, progress, cache state, and last
   opened, but not series — the field most likely to disambiguate near-identical
   titles in a large library.

4. **There is no curation layer.** A Book has no reading status (unread /
   reading / finished) and no way to mark a favourite. So a reader cannot
   separate "what I plan to read" from "what I'm reading" from "what I finished",
   and cannot star the handful of books that matter. This is also the one gap
   that touches Sync: new per-Book fields must converge across devices, and the
   current Manifest has no timestamp for metadata edits at all.

## Solution

Four features that make the Library recoverable, searchable, sortable, and
curatable — in that order of risk.

- **Recycle bin.** Deleting a book becomes recoverable: the EPUB, the cover, the
  reading state, the Annotations, *and the Sessions* land in a local trash entry
  that survives at least `TRASH_TTL`. A "Recently deleted" view lists what is in
  the trash; Restore puts a book back exactly as it was; Delete permanently
  (and the TTL sweeper) removes it for real. Restoring also revokes the Book's
  Tombstone, so the next Sync does not delete the book again — a book that comes
  back *after* its Tombstone is a revival, and the merge engine learns to
  compare the two.
- **Whole-record search.** Search matches every text field on the record and
  splits the query on whitespace so `penguin classics` works like a filter
  rather than a literal phrase.
- **Sort direction and series in the list.** A direction toggle per sort key,
  with each key carrying its own natural default, and a series column in list
  view.
- **Reading status and star.** `BookRecord` grows `readingStatus` and `starred`;
  the shelf gains a status filter and a star toggle on the card; the details
  dialog gains a status field. Both fields sync, which requires the Manifest to
  gain a Book-level revision timestamp so metadata edits have a comparable time
  at all.

The glossary in `CONTEXT.md` is extended where this introduces new language
(Reading status, Starred, Trash).

## User Stories

### Recovery

1. As a reader who deleted a book by mistake, I want a "Recently deleted" view,
   so that I can find it and undo the mistake.
2. As that reader, I want Restore to bring back the EPUB, my reading position,
   my highlights and notes, and my assistant Sessions, so that recovery is
   genuinely complete rather than a hollow shell.
3. As a reader, I want to permanently delete a trash entry, so that I can free
   the disk space immediately when I am sure.
4. As a reader, I want deleted books to disappear from the trash automatically
   after a retention window, so that the trash cannot grow without bound.
5. As a reader, I want the delete confirmation to tell the truth about recovery,
   so that I know deleting is safe and do not fear the button.
6. As a reader with Sync enabled, I want a restored book to stay restored, so
   that the next Sync does not delete it again from its own Tombstone.
7. As a reader, I want to see when a trash entry was deleted and how large it is,
   so that I can decide whether to restore or purge it.
8. As a reader, I want Restore to fail cleanly when the original id is occupied
   again, so that I never get a half-restored or duplicated book.

### Findability

9. As a reader with a series-based library, I want search to match the series
   name, so that I can pull up a whole series.
10. As a reader, I want search to match publisher, language, and description, so
    that whatever I remember about a book is enough to find it.
11. As a reader, I want a multi-word query to match across fields, so that
    "penguin classics" finds the Penguin Classics series even when no single
    field contains both words.
12. As a reader, I want search to stay instant and case-insensitive, so that
    typing stays responsive as my library grows.

### Ordering

13. As a reader, I want to reverse the current sort order, so that I can scan
    from Z to A or from oldest to newest without leaving my sort key.
14. As a reader, I want each sort key to start in its natural direction, so that
    picking "Title" gives me A→Z and picking "Recently opened" gives me newest
    first.
15. As a reader, I want my sort direction remembered between launches, so that
    the shelf opens the way I left it.
16. As a reader in list view, I want a series column, so that I can tell apart
    books whose titles repeat across series.

### Curation

17. As a reader, I want to mark a book as unread, reading, or finished, so that I
    can see the shape of my library at a glance instead of inferring it from a
    percentage.
18. As a reader, I want to filter the shelf by status, so that I can look at
    only what I have not started.
19. As a reader, I want to star a book, so that I can mark the ones that matter
    regardless of status.
20. As a reader, I want to filter to starred books, so that my shortlist is one
    click away.
21. As a reader, I want to star a book directly on its card, so that curating is
    not a dialog round-trip.
22. As a reader, I want to set or clear a book's status from the shelf itself (its
    card or list row), so that curating does not require opening a dialog.
23. As a reader, I want status and star to be cleared-independent of metadata, so
    that starring a book never costs me a title edit.
24. As a reader with Sync, I want status and star to follow me to my other
    devices, so that my curation is not device-local.
25. As a reader with Sync, I want my curation (status, star) to follow me to my
    other devices, so that a sync merge does not silently drop it. (A title edit
    on one device **and** a star on another for the *same* Book is
    last-writer-wins under the single `bookUpdatedAt` — see Out of Scope.)

### Cross-cutting

26. As a bilingual reader, I want all new shelf UI in English and Simplified
    Chinese, so that the feature matches the rest of the app.
27. As a reader, I want the existing library.json, Manifest, and any Synced data
    from earlier versions to keep working, so that upgrading does not lose or
    corrupt anything.

## Implementation Decisions

- **Terminology.** Use the glossary in `CONTEXT.md`. New entries: **Reading
  status**, **Starred**, **Trash**. Prefer "Trash" over "recycle bin" in code and
  copy (the Rust layer already names the directory `.trash`).
- **Trash layout** (local only; never synced, per ADR 0001):
  - `.trash/<bookId>-<operationId>/` — the staged book directory (existing
    layout, unchanged).
  - `.trash/<bookId>-<operationId>/../<bookId>-<operationId>.json` — a
    descriptor holding the deleted `BookRecord` snapshot, `deletedAt`,
    `origin` (`local` | `sync`), the Sessions trash name, and the size.
  - `.trash/<bookId>-<operationId>.sessions/` — the staged Sessions directory.
  - `operationId()` already embeds a UTC timestamp, but it is not reliably
    parseable (trailing hex counter); **timestamps come from the descriptor**,
    with file mtime only as a fallback for descriptor-less crash remnants.
- **Session staging.** `remove_book_sessions` is replaced by a *stage* step so
  Sessions leave `sessions/<bookId>` immediately (Sync must not see them) but
  survive in the trash. `delete_book` and `delete_book_for_sync` both use it.
- **Descriptor-driven recovery.** `recover_staged_deletions` must ignore
  `.sessions` entries (today its `<bookId>-` prefix match would treat a staged
  Sessions directory as a book directory) and must not resurrect entries that
  have a descriptor — those belong to the Trash UI, not to crash recovery.
- **Local deletion vs sync deletion.** Both stage to the trash, but only
  `origin: "local"` entries are offered for Restore. A book deleted by a remote
  Tombstone would be deleted again on the next Sync, so offering Restore for it
  would be a lie; it is listed (greyed, with the reason) and can only be purged.
- **Revival beats the Tombstone.** The merge engine currently drops a book
  whenever an active book Tombstone names it, with no time comparison. Restore
  revokes the local Tombstone *and* the merged book gains a Book-level revision
  timestamp; the merge keeps the book and discards the Tombstone when
  `bookUpdatedAt > deletedAt`. Without this, Restore plus Sync is immediately
  undone.
- **Book-level revision timestamp.** `SyncedBook` gains
  `bookUpdatedAt: string`, bumped by metadata edits (`update_book_metadata`),
  status/star changes, and Restore. It replaces `bookActivityTimestamp`
  (max of position/annotations) as the "which side is newer" signal for
  `metadata` and for revival. Position and Annotations keep their own
  timestamps and merge rules unchanged. A Manifest without `bookUpdatedAt`
  (older device) falls back to the existing `bookActivityTimestamp` rule.
- **Per-field honesty over whole-metadata clobbering.** `mergeBooks` merges
  metadata as `{ ...older, ...newer }`; with one shared timestamp, a status
  change on A and a title edit on B cannot both survive. **Decision:** keep the
  single `bookUpdatedAt` for this iteration and accept last-writer-wins across
  metadata fields (matching the existing title/author behaviour), but *bump*
  `bookUpdatedAt` on every metadata write so the newest edit always wins
  instead of being compared against a reading-progress timestamp it has nothing
  to do with. Per-field envelopes are explicitly out of scope (see below).
- **Schema compatibility.** New `BookRecord` fields are `Option` with
  `#[serde(default, skip_serializing_if = ...)]` so existing `library.json`
  parses unchanged. `SyncBookMetadata` and `SyncedBook` add fields without
  `deny_unknown_fields`, so an older device ignores them; a *downgrade* may drop
  them on its next upload, which is recorded as a known limitation, not solved.
- **Search: tokenized AND across fields.** `filterBooks` lowercases the query,
  splits on whitespace, and requires every token to appear in at least one of
  {title, author, series, publisher, language, description}. Single-token
  queries therefore behave exactly as today (superset), and multi-token queries
  become a filter rather than a phrase. No `field:value` syntax (out of scope).
- **Sort direction.** `LibrarySortOrder = "asc" | "desc"`, persisted in
  localStorage next to the existing sort key. Each `LibrarySortKey` has a
  natural default (`recent`/`imported`/`progress` → `desc`, `title`/`author` →
  `asc`); switching sort key resets direction to that key's default, and the
  toggle flips it.
- **Status/star model.** `readingStatus?: "unread" | "reading" | "finished"`
  (absent = unset, distinct from `"unread"`), `starred?: boolean` (absent =
  false). Both are synced; neither is derived from `lastFraction`.
- **UI surfaces.** Status filter as a `Select` in the header next to Sort
  (All / Unread / Reading / Finished / Starred), not a chip row (the header is
  already dense). Star toggle on `BookCard` and `BookListRow`. Reading status is
  set from a `BookStatusMenu` on the same two hosts — one shared component, IPC
  injected by the shelf — and it is the **only** entry point, so a book with no
  status still renders a dimmed placeholder trigger rather than nothing. The
  details dialog does not carry the field. A "Recently deleted" entry point
  appears next to the existing Select-mode button and only when the trash is
  non-empty.

## Testing Decisions

Tests observe external behaviour through existing seams; no new test seams are
introduced.

1. **Pure frontend functions** (`src/lib/library-shelf.test.ts`, prior art:
   existing sort/filter cases) — tokenized multi-field search, sort direction
   incl. per-key natural defaults, and the status/star filter predicate. These
   are cheap table-driven cases and must cover the multi-token-across-fields
   case (e.g. tokens split across `title` and `series`).
2. **Component tests on the real DOM** (`src/components/LibraryView.test.tsx`,
   `BookCard.test.tsx`, `BookDetailsDialog` coverage, prior art: existing
   `onDelete`/`onDetails` invokes) — assert the *IPC calls*, not internal state:
   starring a card invokes the status command with the right payload; the status
   filter narrows the rendered cards; Restore invokes `restore_trashed_book` and
   the shelf refreshes; the delete confirmation copy no longer claims
   irreversibility.
3. **Rust unit tests** (prior art: `sync::tombstone_tests`, `library.rs` inline
   tests) — trash descriptor round-trip (delete → list → restore returns an
   identical `BookRecord` and Sessions), descriptor-less crash remnant is
   recovered while a descriptor-bearing entry is not, `.sessions` entries are
   never mistaken for book directories, TTL sweeper removes only expired
   entries, and restore revokes the Tombstone.
4. **Merge-engine property tests** (`src/lib/sync-merge.test.ts`, prior art:
   existing commutativity assertions) — with `bookUpdatedAt`: metadata edits
   win by that timestamp (not by reading position), and a revival newer than a
   Tombstone keeps the book while an older one stays deleted; commutativity
   (`merge(a,b) == merge(b,a)`) must hold for both.

## Out of Scope

- Per-field metadata envelopes (each field with its own timestamp). The single
  `bookUpdatedAt` is the deliberate scope boundary; revisit only if users report
  lost edits from concurrent metadata edits on two devices. Consequence: User
  Story 25's "title here, star there, both survive" holds across *different*
  Books but not for concurrent edits to different fields of the same Book.
- Cross-book full-text search (needs an index; separate effort).
- Collections / tags as a new domain concept (a bigger sibling of status).
- Shelf virtualisation for very large libraries.
- Metadata enrichment from external sources (Open Library / Google Books).
- Watched folders / bulk folder import / Calibre import.

## Further Notes

- The privacy line in `README.md`/`README.zh-CN.md` needs no change: the Trash is
  local by construction and `CONTEXT.md` already says the local trash never
  syncs.
- `CHANGELOG.md` gets entries under `[Unreleased]` when each ticket lands.
- Ordering: tickets 01 and 02 are pure frontend and unblocked; 03 is the Rust
  trash foundation; 04 is the Manifest timestamp that both Recovery-with-Sync and
  Curation depend on; 05 and 06 sit on top of those.
