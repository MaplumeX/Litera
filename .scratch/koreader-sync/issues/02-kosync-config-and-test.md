# 02: KOReader Sync settings and connection test

**What to build:** A "KOReader Sync" section in the Settings dialog: enable toggle, server URL (placeholder `https://sync.koreader.rocks`, hint for BookOrbit `https://<host>/api/v1/koreader`), username, password, "Test connection" (`GET {base}/users/auth` with `x-auth-user` / `x-auth-key: md5(password)`). Stored in `kosync_config.json` (plaintext, local, never synced), keeping only `md5(password)`; a blank password on save keeps the stored key. Shows last sync time and last error. English and Simplified Chinese copy.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Settings section, persisted across restarts, off by default
- [x] Test connection reports success / invalid credentials / unreachable server
- [x] Trailing slash in URL tolerated
- [x] Form test following `SyncSettingsForm.test.tsx`
