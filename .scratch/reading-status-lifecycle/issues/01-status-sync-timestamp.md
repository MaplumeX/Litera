# 01: Status gets its own sync timestamp

**What to build:** Reading status orders on its own `statusUpdatedAt` instead of the shared `bookUpdatedAt`, so status and metadata edits on different devices both survive. Prerequisite for automatic transitions, which would otherwise clobber metadata on every page turn.

**Status:** resolved

- [x] `BookRecord` (Rust + TS) and `SyncBookMetadata` (Rust + `sync-merge.ts`) gain optional `statusUpdatedAt`; old files and Manifests parse unchanged
- [x] `update_book_curation` bumps `statusUpdatedAt` (not `updatedAt`) when it changes the status, and `updatedAt` when it changes the star
- [x] Export/apply round-trips `statusUpdatedAt`
- [x] `mergeBooks` resolves `readingStatus` per the spec's three-step rule, commutatively
- [x] `sync-merge.test.ts` covers every branch in both orders, plus status-on-A + title-on-B both surviving
