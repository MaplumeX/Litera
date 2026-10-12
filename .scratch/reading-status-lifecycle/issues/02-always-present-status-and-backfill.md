# 02: Always-present status, `paused`, and backfill

**What to build:** Every Book has a Reading status. `paused` joins the set, import sets `unread`, and existing Books are backfilled once from their progress.

**Blocked by:** 01

**Status:** resolved

- [x] `VALID_READING_STATUSES` and TS `ReadingStatus` gain `paused`; TS `readingStatus` becomes required
- [x] `update_book_curation` rejects an empty status
- [x] Import creates records with `unread`
- [x] On library load, records without a status are backfilled (`FINISH_FRACTION = 0.98`) and persisted once, without `statusUpdatedAt`
- [x] Sync-created records whose Manifest entry has no status are backfilled the same way from the synced position
- [x] Rust tests for the thresholds and the sync placeholder case
