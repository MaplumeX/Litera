# Spec: Reading status lifecycle

Status: resolved

## Problem Statement

Reading status shipped (library-management ticket 06) as pure manual curation:
absent by default, distinct from `unread`, and never derived from progress. In
practice that makes it close to useless:

1. **Most Books never get a status.** Nothing sets it except the reader, so a
   Book read to 60% or to the last page still has none. The Reading / Finished
   tabs stay near zero and the filter has nothing to filter.
2. **"Unset" vs "Unread" is a modelling distinction, not a reader one.** A
   freshly imported Library shows 0 under Unread even though nothing has been
   read. The menu carries four choices, and the hover-only "+ Status"
   placeholder exists only to paper over the absent state.
3. **Two independent notions of "reading".** Continue reading is derived from
   `lastOpenedAt`; the status is manual. They disagree (an "unread" Book in
   Continue reading; a Book "finished" at 5%).
4. **No entry point where the decision happens.** The natural moment to mark a
   Book finished is the last page, inside the reader, but status lives only on
   the shelf.
5. **No way to put a Book down.** A Book abandoned halfway sits in Reading and
   in Continue reading forever.
6. **Status edits clobber metadata on Sync.** Status shares `bookUpdatedAt` with
   title/author, so a status change on one device and a title edit on another
   lose one of the two. Automatic transitions would make this far more frequent.

## Solution

Reading status becomes **always present** and **advanced by the app at clear
moments**, while staying a stored, explicit field the reader can override at any
time:

- Four statuses: `unread`, `reading`, `paused`, `finished`. No absent / unset.
- Import sets `unread`. Existing Books are backfilled once from their progress.
- The first page turn of an open moves an `unread` or `paused` Book to
  `reading`.
- Reaching the end of a Book offers "Mark as finished" in the reader. The app
  never sets `finished` on its own during reading.
- Continue reading shows exactly the `reading` Books.
- Status gets its own sync timestamp, `statusUpdatedAt`, so it no longer
  competes with metadata edits.

## User Stories

1. As a reader, I want a newly imported Book to count as Unread, so that the
   Unread tab shows what I have not started.
2. As a reader, I want a Book to become Reading when I start reading it, so
   that I never have to curate that by hand.
3. As a reader who reaches the last page, I want to be offered "Mark as
   finished" right there, so that I can close the loop without going back to
   the shelf.
4. As a reader, I want to put a Book on hold, so that it leaves Reading and
   Continue reading without being called finished.
5. As a reader who picks a paused Book back up, I want it to return to Reading
   on its own.
6. As a reader re-opening a finished Book to look something up, I want its
   status left alone.
7. As a reader upgrading with an existing Library, I want my Books' statuses
   filled in from how far I got, so that the tabs are useful immediately.
8. As a reader, I want Continue reading and the Reading tab to agree.
9. As a reader with Sync, I want a status change on one device and a title edit
   on another to both survive.
10. As a reader, I want to override any status by hand from the shelf, the book
    menu, or batch Mark as.

## Implementation Decisions

- **Model.** `ReadingStatus = "unread" | "reading" | "paused" | "finished"`.
  TS `BookRecord.readingStatus` becomes required. Rust keeps the field `Option`
  on the wire so old `library.json` and old Manifests still parse, but every
  record is normalized to `Some` on load and on creation (import, sync
  placeholder). `update_book_curation` no longer accepts an empty string to
  clear the status.
- **`FINISH_FRACTION = 0.98`** is the single "at the end" threshold, shared by
  the backfill and the reader's finish prompt.
- **Backfill** (one-time, local, on library load for any record without a
  status, and for sync-created records whose Manifest entry carries none):
  no `lastFraction` or `0` → `unread`; `>= FINISH_FRACTION` → `finished`;
  otherwise → `reading`. Backfilled statuses carry **no** `statusUpdatedAt`.
- **Auto-start.** A new Rust command `mark_book_started(bookId)` moves
  `unread` / `paused` to `reading` and is a no-op for `reading` / `finished`.
  The frontend (`src/lib/use-reading-status.ts`) calls it once per open, on the
  first relocate whose fraction moves away from the one that restored the saved
  position, so merely opening a Book (or re-paginating it) does not count. The
  transition is done in Rust so it is atomic with respect to the stored status
  rather than decided from a possibly stale frontend copy.
- **Finish prompt.** When the reader moves to `FINISH_FRACTION` or past it and
  the Book is not `finished`, the reader shows a small non-modal prompt
  ("Finished this book? · Mark as finished") at most once per open. Opening a
  Book already parked at the end does not prompt until the reader moves.
  Dismissing it changes nothing. `BookOpenContext` gains `readingStatus`.
- **Status timestamp.** `BookRecord` gains `statusUpdatedAt`; in the Manifest it
  lives in the Book's `metadata` next to `readingStatus`, so the pair travels
  together even through a merge by an older version (which spreads metadata
  but rebuilds the top-level `SyncedBook`). Sync placeholders carry both, so a
  not-yet-downloaded Book shows its synced status.
  Every status write (manual, batch, auto-start, finish prompt) bumps
  `statusUpdatedAt` and **not** `updatedAt` / `bookUpdatedAt`. Star and
  metadata writes keep bumping `updatedAt` as today.
- **Status merge rule** in `mergeBooks`, applied to `readingStatus` after the
  metadata spread:
  1. Both sides timestamped → newer `statusUpdatedAt` wins.
  2. Exactly one side timestamped → it wins (a reader's choice beats a
     backfill).
  3. Neither timestamped → the further-along status wins, by rank
     `unread < reading = paused < finished` (ties keep the
     `bookUpdatedAt`-newer side). Backfill only ever produces `unread`,
     `reading`, or `finished`, so this converges two devices that backfilled
     from different local progress.
  The rule must be commutative, like the rest of the merge.
- **Continue reading** is `readingStatus === "reading"` with `lastOpenedAt`,
  most recent first, still narrowed by the active status filter.
- **Shelf UI.** Tabs: All / Unread / Reading / On hold / Finished | Starred.
  `BookStatusMenu`, the book menu's Reading status submenu, and batch Mark as
  offer the four statuses and no "unset". The dashed "+ Status" placeholder is
  removed. To keep an all-Unread fresh Library quiet, the `unread` label shows
  only on hover / focus / while its menu is open; other statuses stay visible.
- **Copy.** en: Unread / Reading / On hold / Finished. zh-CN: 未读 / 在读 / 搁置 /
  已读. `library.status.unset` and `library.status.add` are removed.
- **Glossary.** `CONTEXT.md` **Reading status** is rewritten to the new
  definition (done alongside this spec).

## Testing Decisions

- Rust (`library.rs` tests): backfill thresholds incl. `0`, `None`, just below
  and at `FINISH_FRACTION`; normalization of sync placeholders;
  `mark_book_started` for each starting status; status writes bump
  `statusUpdatedAt` but not `updatedAt`; empty status rejected; `paused`
  accepted.
- `src/lib/sync-merge.test.ts`: each branch of the status merge rule, in both
  merge orders; status on device A + title edit on device B both survive; old
  Manifest without `statusUpdatedAt` falls back as specified.
- `src/lib/library-shelf.test.ts`: `paused` filter and count; `takeRecent`
  only returns `reading`.
- `LibraryView.test.tsx`: menus offer four statuses and no unset; On hold tab.
- Reader: the first relocate after open does not call `mark_book_started`, the
  second does, once; the finish prompt appears at the threshold, once per open,
  and not for `finished` Books.

## Out of Scope

- `startedAt` / `finishedAt` history and reading statistics. The
  `statusUpdatedAt` envelope makes these a later additive change.
- Re-read counts.
- Automatic `finished` without the reader's confirmation.
- A status control in the reader beyond the finish prompt.
