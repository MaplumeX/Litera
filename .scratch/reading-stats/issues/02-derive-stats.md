# 02: Derive reading stats

**What to build:** A command returns the Sittings of every Reading log on this device, and pure functions turn them and the Library into the numbers the page shows.

**Blocked by:** 01

**Status:** resolved

- [x] A Rust command reads all files in `<root>/reading-log/`, skipping unknown `schemaVersion`s and corrupt files with a warning
- [x] `src/lib/reading-stats.ts` is pure and takes "today" as an argument
- [x] Week, month and year periods, with previous-period change and an all-time total
- [x] Time, days read, daily average over the period's elapsed days, current streak
- [x] Per-day and per-month totals; a 52-week day series for the heatmap
- [x] Per-Book totals with last read, labelled from the Library or else the log's title snapshot
- [x] Finished count from `statusUpdatedAt`; backfilled statuses count only under all time
- [x] Dates use each Sitting's own UTC offset
- [x] Tests per the spec, including several devices summed

## Comments

- Change from the previous period compares the same stretch, so three days into a month is set against the first three days of the month before, not all of it. Whole past periods clip to the shorter one.
- Weeks start on Monday in every locale.
- A Sitting's date comes from its own `start` text, so it stays the date as lived. `statusUpdatedAt` is a UTC instant with no offset, so a finish date uses the viewing device's timezone.
