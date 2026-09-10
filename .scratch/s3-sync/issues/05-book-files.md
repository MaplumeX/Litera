# 05: EPUB and cover upload with on-demand download

**What to build:** The large-object half of Sync. When Sync is first enabled on a device that already has books, an upload-size estimate is shown and the bulk upload only starts after confirmation. New imports thereafter upload automatically, using multipart upload with resume so large books survive flaky connections. On a new device, the shelf renders instantly from the Manifest; covers and EPUB files download on demand (cover when displayed, book file when opened) and are cached locally. Book cards clearly show a "not cached" state for books whose file isn't local, and opening such a book downloads it first. Verifiable: enable Sync on a full library, confirm the estimate, see books appear on a fresh machine, open one and read it.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [ ] First-enable flow shows an upload-size estimate before bulk-uploading the existing library; upload starts only after confirmation
- [ ] New imports upload automatically after Sync is enabled
- [ ] Book uploads use multipart with resume for large files
- [ ] New device: shelf and reading positions render immediately from the Manifest without waiting for files
- [ ] Covers download on demand when displayed; EPUB files download on demand when a book is opened
- [ ] Downloaded books are cached locally and re-openable offline
- [ ] Book cards show a "not cached" state for books whose file isn't local, with localized copy
- [ ] App-level tests cover the "not cached" card state and the estimate confirmation flow
