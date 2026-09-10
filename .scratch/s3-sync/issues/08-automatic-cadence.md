# 08: Automatic cadence, failure surfacing, and privacy copy

**What to build:** Sync stops requiring button presses: it runs automatically at app startup, after local changes settle down (debounced), and periodically on the order of minutes, so a long reading session stays converged across devices without intervention. Sync failures retry silently; only after several consecutive failures does a non-blocking toast appear, and the Settings Sync section always shows last-run time and status. Sync UI never interrupts reading. The README privacy statement is rewritten in both English and Simplified Chinese to reflect the new promise: books stay on your machine until you enable Sync; synced data is stored as-is on the bucket you choose.

**Blocked by:** 03 (First sync — Manifest push/pull). Recommended to implement after 04–07 so the debounced local-change signal covers all synced data kinds.

**Status:** ready-for-agent

- [ ] Sync runs automatically at app startup when enabled
- [ ] Local changes (page turns, annotations, sessions, preference edits) trigger a debounced push
- [ ] Periodic re-sync runs on the order of minutes during long sessions
- [ ] Transient failures retry silently with no UI
- [ ] A non-blocking toast appears only after several consecutive failures; dismissable, never modal
- [ ] Settings Sync section shows last sync time and last status/error
- [ ] README (English and Simplified Chinese) privacy statements rewritten
- [ ] App-level tests cover the toast threshold and startup sync trigger
