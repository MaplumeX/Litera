# Spec: Reading stats

Status: ready-for-human

## Problem Statement

A reader cannot see how much they read. The app keeps only latest values
(`lastOpenedAt`, `lastFraction`, `statusUpdatedAt`), so it has no reading time
at all, and no way to answer "how long did I read this month?" or "which Book
took my time?". Time already spent reading cannot be recovered, so every release
without a record loses data for good.

## Solution

A **Reading log** records each **Sitting** (one continuous stretch of reading a
Book). A **Reading stats** page derives every number from the log when shown;
no totals are stored. Each device writes its own log file, so Sync combines
devices without merge conflicts.

Time counting starts when the log ships. The page says so instead of showing
misleading zeros, and shows what already exists (finished Books, progress).

## User Stories

1. As a reader, I want my reading time recorded without doing anything, so that
   the stats are there when I first look.
2. As a reader, I want a Book left open overnight not to count as hours of
   reading, so that the numbers stay believable.
3. As a reader in Agent mode or a Guided session, I want that time to count,
   since it is how I read the Book, even though no pages turn.
4. As a reader, I want total time, days read, daily average and Books finished
   for a week, month or year, so that I can see how a period went.
5. As a reader, I want a year heatmap and a time chart, so that I can see the
   rhythm of my reading.
6. As a reader, I want to pick a day on the heatmap and see what I read then.
7. As a reader, I want the Books of a period ranked by time and to open one from
   there.
8. As a reader, I want a deleted Book's time kept and still labelled by title.
9. As a reader with several devices, I want one total across them.
10. As a privacy-minded reader, I want to turn recording off, and to be told
    that with Sync on the log is uploaded in plaintext.

## Implementation Decisions

### Glossary

Add to `CONTEXT.md` (**Session** already means an assistant conversation, so it
must not be used here):

- **Sitting**: one continuous stretch of reading one Book on one device, with
  its active time and how far the position moved. _Avoid_: Session, reading
  session.
- **Reading log**: the per-device, append-oriented record of Sittings. Reading
  stats are always derived from it. _Avoid_: Stats file, history.

### What counts as reading

Time counts while a Book is open, the window is visible, and there is recent
activity:

- Activity is a user relocate (`onUserRelocate`), a pointer, key or wheel event
  in the reader (including inside foliate's section iframes, next to the
  existing listeners in `ReaderView`'s `load` handler), or in the chat panel.
- TTS playing and an assistant reply streaming count as activity through a
  15-second heartbeat, because the reader is engaged with no input.
- The restoring relocate and re-pagination are not activity.
- Agent mode and Guided sessions count. `mode` (`ReaderMode`) is recorded on
  each Sitting so they can be told apart later.

### Time rules

Constants live together and are expected to be tuned:

- `IDLE_CAP_MS = 180_000`. The gap between two activities credits
  `min(gap, IDLE_CAP_MS)`.
- A gap over the cap ends the Sitting. So does closing the Book, and local
  midnight, so a Sitting always belongs to one local date.
- While the window is hidden, nothing is credited. Coming back within
  `IDLE_CAP_MS` continues the same Sitting, so switching windows does not
  fragment it; later starts a new one.
- `MIN_SITTING_SECONDS = 30`. A shorter Sitting is dropped when it ends, so
  opening a Book to look something up leaves no trace.
- The open itself is the first activity. Closing the Book is the last.
- `from` is the fraction when the Sitting starts and `to` the latest fraction.

`SittingTracker` is a plain class with an injected clock holding these rules.
`use-reading-tracker.ts` is a thin hook that feeds it events; it is wired into
`use-reader-session.ts` beside `useReadingStatus` (`begin` / `onRelocate` /
`end`), so desktop and mobile share it.

### Storage

Local file `<root>/reading-log/<deviceId>.json`:

```jsonc
{
  "schemaVersion": 1,
  "deviceId": "…",
  "books": { "<bookId>": { "title": "…", "author": "…" } },
  "sittings": [{
    "id": "<uuid>",
    "bookId": "…",
    "start": "2026-11-03T22:10:00+08:00",
    "seconds": 1260,
    "from": 0.31,
    "to": 0.34,
    "mode": "reader"
  }]
}
```

- A Rust command upserts a Sitting by `id` and refreshes the `books` snapshot,
  in `src-tauri/src/reading_log.rs`, using an atomic write under a lock.
- The tracker checkpoints every 60 seconds and when a Sitting ends, also on
  `flushReadingState` paths (closing the window, leaving the reader). A crash
  loses about a minute at most. A Sitting under `MIN_SITTING_SECONDS` is never
  written, at a checkpoint or otherwise, so nothing needs removing later.
- `start` keeps the UTC offset; a Sitting's date is the local date as lived, so
  travel does not disturb days read or streaks.
- `deviceId` is `SyncState.device_id`. `read_sync_state` makes a new uuid on
  every call while `sync-state.json` is missing, without saving it, so the log
  must get the id through `update_sync_state`, which persists it.
- Unknown `schemaVersion` values and corrupt files of other devices are skipped
  with a warning, never fatal. The device's own corrupt file is set aside and a
  new one started, so recording never blocks reading.
- Deleting a Book does not touch the log. Book ids derive from content, so a
  re-import continues the same totals.

### Recording setting

`litera.readingStatsEnabled` in `localStorage`, default on, per device (ADR 0001),
in a `stats` Settings section. Not in `preferences.json`, like the reader footer:
its parser rejects unknown keys, so a new key there would reset an older build's
settings. Off stops recording and uploading new data; existing data stays and the
page still shows it. Clearing data is out of scope.

### Derivation

`src/lib/reading-stats.ts` is pure: Sittings in, numbers out. It takes "today"
as an argument.

- Time, days read, daily average (over the elapsed days of the period), change
  from the previous period, current streak, per-day and per-month totals,
  per-Book totals.
- Finished count: Books with status `finished` whose `statusUpdatedAt` falls in
  the period. Backfilled statuses have no timestamp, so they count only under
  "all time". Re-marking a Book moves its date; this is accepted, and re-reads
  are not counted.
- Page numbers are not used: reflowable pagination changes with window size and
  font, so they are not comparable over time.

### Page

- **Desktop entry**: an item in `LibrarySidebar`'s bottom group, above Trash. It
  swaps the shelf pane inside `LibraryView` and keeps the sidebar; it is not a
  dialog, since the charts need room.
- **Mobile entry**: an item in the Library's overflow menu, above Trash, opening a
  new `stats` page in `MobileApp`'s page stack, with the same transition as Trash.
- **Layout**, top to bottom: title with Week / Month / Year switch and ‹ › period
  navigation; stat tiles (time with change, days with streak as small print,
  daily average, finished); 52-week heatmap, independent of the period, where
  picking a day shows that day's Books; time bars (by day for week and month, by
  month for year); Books of the period ranked by time, with cover, title, author,
  time, progress and last read, opening the Book on click.
- **Deleted Books** in the ranking show the log's title snapshot with no cover,
  and do not open.
- **Mobile layout**: tiles 2×2, the heatmap scrolls horizontally starting at the
  latest weeks, the rest in one column.
- **Empty state**: says recording starts now, and tells the reader if recording
  is off.
- **Charts** are hand-written SVG/CSS using `--chart-*`, with no chart library,
  and `Tip` for values. The heatmap uses one hue in steps. Read the `dataviz`
  skill before building them. Values must be reachable by keyboard, and motion
  respects `motion-reduce`.
- **No gamification**: no badges, goals or rankings.
- **Copy** in en and zh-CN through `i18n.ts`.

### Sync

- Each device uploads only its own log, to `litera/stats/<deviceId>.json`, and
  only when it changed, tracking the content hash in `reading-log-sync.json`.
  Not in `SyncState`, whose parser rejects unknown fields, so a new field would
  break an older build after a downgrade.
- Other devices' logs are found by listing the prefix, as `sync_sessions` does,
  and saved to `<root>/reading-log/` when their etag changes. They are never
  edited or re-uploaded.
- The log stays out of the Manifest: it grows without bound, and the Manifest is
  rewritten whole on every Sync.
- Per-item state resets with the other object state when the backend changes, so
  a new backend receives this device's log.
- Failure to sync the log must not fail the Sync pass.
- A reading timeline is more private than a shelf, and it is plaintext on the
  Sync Backend. The first-enable disclosure mentions it, and readers who already
  have Sync on get a one-time `NoticeStack` notice the first time the log is
  uploaded, pointing to the setting.
- Record the decision in `docs/adr/0003-reading-log-sync.md`.

## Testing Decisions

- `SittingTracker` with a fake clock: cap, Sitting end over the cap, hidden time,
  return within and past the cap, midnight split, drop under the minimum,
  heartbeat, restoring relocate ignored, checkpoint.
- `reading-stats.ts`: period boundaries, offsets (a Sitting near midnight in
  another timezone), streaks including today unread, previous-period change with
  no data, finished counting with and without `statusUpdatedAt`, several devices
  summed, deleted Book labels.
- Rust `reading_log.rs`: upsert by id, snapshot refresh, corrupt own file set
  aside, other devices' bad files skipped, stable device id across calls when
  `sync-state.json` starts missing.
- Rust sync, against the in-memory store as `sync_sessions_with` tests do: upload
  only on change, only own file, download on etag change, failure isolated,
  reset on backend change.
- UI (jsdom + RTL, mocked `invoke`): the sidebar and drawer entries, period
  switching, day pick, opening a Book, deleted Book row, empty states.
- Confirm in the real app on desktop and Android: time accrues in reader and
  Agent mode, and stops when the window is hidden or the phone is locked.

## Tickets

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | Record Sittings to the Reading log | ready-for-human | — |
| 02 | Derive reading stats | resolved | 01 |
| 03 | Desktop Reading stats page | resolved | 02 |
| 04 | Mobile Reading stats page | ready-for-human | 03 |
| 05 | Sync the Reading log | ready-for-human | 01 |

Ticket 01 should ship as early as possible, ahead of the page, since it is what
starts the data accumulating.

## Out of Scope

- A per-Book stats view and reading stats inside the reader.
- Reading speed and estimated time left.
- Time-of-day charts and average Sitting length. The log already holds what they
  need, so they are later additive changes.
- Goals, badges and reminders.
- Clearing or exporting the log.
- Backfilling time from existing data, which does not exist.
- Re-read counts and a `finishedAt` history.
- Counting KOReader or other external reading.
