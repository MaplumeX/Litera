# 04: Push reading position to the Progress Server

**What to build:** When KOReader Sync is enabled and the Book has a `koreaderHash`, a position move (same rule that bumps `positionUpdatedAt`) schedules a push after ~10 s of quiet: `PUT {base}/syncs/progress` with the XPointer from issue 03, the book fraction as `percentage`, `device: "Litera"` and the local device id. Flush on book close and window close (short timeout, reusing the S3 Sync close hook). Skip duplicates of the last pushed pair.

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [x] Debounced push, flush on close
- [x] Unknown book (404) and network errors are silent; 401 recorded as last error
- [x] Tests with mocked `invoke` for debounce and duplicate suppression
