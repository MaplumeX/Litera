# 05: Sync the Reading log

**What to build:** With Sync on, each device uploads its own Reading log and downloads the others', so reading stats total across devices.

**Blocked by:** 01

**Status:** ready-for-human

- [x] Upload own log to `litera/stats/<deviceId>.json`, only when its content hash changed, tracked in `reading-log-sync.json`
- [x] List the prefix and download other devices' logs on etag change, into `<root>/reading-log/`; never edit or re-upload them
- [x] Runs after the Manifest in a Sync pass; a log failure is reported but does not fail the pass
- [x] Nothing about the log enters the Manifest
- [x] State resets when the endpoint, region or bucket changes, so a new backend receives this device's log
- [x] With `readingStatsEnabled` off, new data is not uploaded
- [x] First-enable disclosure mentions the Reading log; readers already on Sync get a one-time `NoticeStack` notice at the first upload, pointing to the setting; en and zh-CN
- [x] `docs/adr/0003-reading-log-sync.md` records per-device files outside the Manifest and the plaintext consequence
- [x] README Sync section (en and zh-CN) lists the Reading log among synced data
- [x] An open stats page refreshes when a pass downloads logs (`litera:reading-logs-synced`; `litera:sync-applied` fires before they arrive)
- [x] Rust tests against the in-memory store, per the spec
- [ ] Checked against a real S3-compatible backend with two devices

## Comments

- Bookkeeping lives in `reading-log-sync.json`, not `SyncState`: that struct has `deny_unknown_fields`, so a new field would break an older build after a downgrade. Spec and ADR say so.
- The one-time notice shows to anyone on their first upload, including readers who just saw the first-enable disclosure. Telling them twice is harmless, and it comes after the upload, as the spec says.
- A log failure is only logged to the console: nothing is shown to the reader, and the next pass retries.
