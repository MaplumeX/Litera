# 08: Automatic cadence, failure surfacing, and privacy copy

**What to build:** Sync stops requiring button presses: it runs automatically at app startup, after local changes settle down (debounced), and periodically on the order of minutes, so a long reading session stays converged across devices without intervention. Sync failures retry silently; only after several consecutive failures does a non-blocking toast appear, and the Settings Sync section always shows last-run time and status. Sync UI never interrupts reading. The README privacy statement is rewritten in both English and Simplified Chinese to reflect the new promise: books stay on your machine until you enable Sync; synced data is stored as-is on the bucket you choose.

**Blocked by:** 03 (First sync — Manifest push/pull). Recommended to implement after 04–07 so the debounced local-change signal covers all synced data kinds.

**Status:** ready-for-agent

- [x] Sync runs automatically at app startup when enabled
- [x] Local changes (page turns, annotations, sessions, preference edits) trigger a debounced push
- [x] Periodic re-sync runs on the order of minutes during long sessions
- [x] Transient failures retry silently with no UI
- [x] A non-blocking toast appears only after several consecutive failures; dismissable, never modal
- [x] Settings Sync section shows last sync time and last status/error
- [x] README (English and Simplified Chinese) privacy statements rewritten
- [x] App-level tests cover the toast threshold and startup sync trigger

## Comments

- `useSyncScheduler` (App-level hook): startup sync when enabled, 30s debounce after local-change signals, 5-minute periodic re-sync. Signals (`notifySyncActivity`) are fired by: reading-position updates, annotation saves, session appends (session-port), preference saves, book imports, deletes, and metadata edits.
- Failures are silent; a dismissable non-blocking banner (`SyncFailureBanner`, role=status) appears only after 3 consecutive failures and clears on the next success. Sync UI never interrupts reading.
- Settings Sync section shows last-run time and last error (`sync_note_result` records outcomes; `get_sync_state` exposes them).
- Auto-sync passes `uploadFiles: true`; Rust silently skips file uploads until the first bulk-upload estimate is confirmed, so the Manifest still converges.
- README privacy statements rewritten in English and Simplified Chinese ("books stay on your machine until you enable Sync; synced data is stored as-is on the bucket you choose").
- Tests: `use-sync-scheduler.test.ts` (startup trigger, disabled no-op, debounce coalescing, periodic, toast threshold + dismissal + recovery) and SyncSettingsForm status display.

## Comments (post-review)

- Review fix: the scheduler records outcomes via `sync_note_result`, so the Settings status stays accurate for automatic runs (failures recorded, recovery clears the last error).
- Review fix: `runSyncOnce` always emits `litera:sync-applied`; the shelf re-reads the Library on it (new placeholders, promotions, deletions render without a remount), while preferences reload is gated on the event's `preferencesSynced` flag to avoid visually reverting mid-edit local changes.
