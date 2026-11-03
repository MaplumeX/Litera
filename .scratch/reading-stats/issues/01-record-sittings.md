# 01: Record Sittings to the Reading log

**What to build:** While a Book is open in the reader, on desktop or Android, active reading time is recorded as Sittings in this device's Reading log, following the spec's time rules. There is no UI beyond the setting.

**Blocked by:** None (can start immediately).

**Status:** ready-for-human

- [x] `SittingTracker` holds the time rules with an injected clock: `IDLE_CAP_MS`, Sitting end over the cap, on close and at local midnight, hidden time uncredited, return within the cap continues the Sitting, `MIN_SITTING_SECONDS` drop
- [x] `use-reading-tracker.ts` feeds it from `use-reader-session.ts`, so desktop and mobile share it; the restoring relocate and re-pagination are not activity
- [x] Pointer, key and wheel activity is seen inside foliate's section iframes and in the chat panel
- [x] TTS playing and an assistant reply streaming count through a 15-second heartbeat
- [x] `src-tauri/src/reading_log.rs`: a command upserts a Sitting by `id` and refreshes the `books` snapshot, with an atomic write under a lock
- [x] Checkpoint every 60 seconds and on `flushReadingState` paths, including window close and Android going to the background
- [x] `deviceId` comes through `update_sync_state`, so it is stable even with no `sync-state.json` and Sync never enabled
- [x] A corrupt own log is set aside and a new one started; recording errors never interrupt reading
- [x] `readingStatsEnabled` preference (default on) with a toggle in Settings, en and zh-CN
- [x] **Sitting** and **Reading log** added to `CONTEXT.md`
- [x] Tests per the spec
- [ ] Confirmed in the real app that time stops when the window is really hidden (minimized on desktop, locked on Android)

## Comments

- Setting lives in `localStorage`, not `preferences.rs`: `preferences.json` rejects unknown keys, so a new key would reset an older build's settings. Spec updated.
- Checked in the real desktop app under WSLg, with a temp data directory: the log file is named by the persisted device id; a Sitting saves with title, author and a `+08:00` start; an idle Book stops at 180 seconds; a page turn after the gap starts a new Sitting; switching to Agent starts an `agent` Sitting; closing the Book writes the last one.
- Not checked: under WSLg, minimizing or unmapping the window leaves `document.visibilityState` at `visible`, so hiding was simulated by dispatching `visibilitychange` (no growth over 78 seconds, and returning continued the same Sitting). If a platform reports `visible` while minimized, a minimized Book counts for at most one `IDLE_CAP_MS`. Check on Windows, macOS and Android; if minimizing is not reported, consider Tauri's window state events.
- Not checked: Android, real pointer input inside an iframe (covered by a `ReaderView` test only), and TTS and streaming heartbeats in the real app (covered by hook tests only).
