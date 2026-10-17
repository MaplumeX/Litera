# Spec: KOReader Sync (reading progress via the kosync protocol)

Status: ready-for-agent

## Problem Statement

Many Litera readers also read on an e-ink device running KOReader, or keep their library in a self-hosted BookOrbit server (which itself syncs with KOReader, Kobo and its web reader). Today Litera's reading position lives only in Litera (and in the user's own S3 Sync Backend). Switching from Litera on the desktop to KOReader on the e-reader means finding the page again by hand, in both directions.

## Solution

Litera speaks the **kosync** protocol — the progress-sync protocol of KOReader's built-in "Progress sync" plugin — as a client. One feature covers every kosync-compatible server:

| Server | Base URL the user enters |
| --- | --- |
| KOReader's public server | `https://sync.koreader.rocks` |
| Self-hosted `koreader-sync-server` | `https://<host>` |
| BookOrbit | `https://<host>/api/v1/koreader` |
| Others (Calibre-Web-Automated, …) | their kosync endpoint |

The reader enters a server URL, username and password in Settings (for BookOrbit: the KOReader credentials created under BookOrbit's KOReader settings). From then on Litera pushes its position after reading and pulls the remote position when a book is opened, jumping there when the remote position is newer.

Scope is **reading progress only**. Annotations are out of scope: the kosync protocol has no annotation channel (BookOrbit's highlight exchange is a private API of its own KOReader plugin).

## Protocol facts (verified against KOReader's plugin and BookOrbit's server)

- `GET  {base}/users/auth` — credential check, 200 on success, 401 otherwise.
- `GET  {base}/syncs/progress/{document}` — returns `{document, progress, percentage, device, device_id, timestamp}` or `{}`.
- `PUT  {base}/syncs/progress` — body `{document, progress, percentage, device, device_id}`; server stamps `timestamp` (Unix seconds).
- Auth headers on every call: `x-auth-user: <username>`, `x-auth-key: md5(password)` (lowercase hex). `Accept: application/vnd.koreader.v1+json`.
- `document` is KOReader's **partial MD5** of the file bytes (its default "binary" matching): MD5 over 1 KiB blocks read at offsets `1024 << (2*i)` for `i = -1..10` (the `i = -1` step is offset 0), stopping at the first offset ≥ file size. BookOrbit resolves this hash against its own files, so the same EPUB file matches on all three sides.
- `progress` for EPUB is a CREngine **XPointer**, e.g. `/body/DocFragment[12]/body/div/p[5]/text().38`. `DocFragment[n]` is the 1-based spine index; element steps are 1-based among same-name siblings and the `[k]` is omitted when the name is unique; text offsets count code points in CREngine's whitespace-collapsed text.
- KOReader applies a pulled EPUB position via `GotoXPointer`, so pushing only a percentage is **not** enough — Litera must send a resolvable XPointer.

## User Stories

1. As a KOReader user, I want to enter a kosync server URL, username and password in Settings and test the connection, so that Litera and my e-reader share progress.
2. As a BookOrbit user, I want the same settings to work with my BookOrbit server, so that Litera joins my BookOrbit/KOReader/Kobo progress loop.
3. As a reader, I want KOReader Sync to be off by default and independent of S3 Sync, so that I can use either, both, or neither.
4. As a reader who stops reading in Litera, I want my position pushed shortly after I stop turning pages and when I close the book or the app, so that the e-reader finds it.
5. As a reader who opens a book in Litera after reading on KOReader, I want Litera to ask whether to jump to the KOReader position when it is newer, so that I continue where I left off but never lose my local place without consent.
6. As a reader, I want a book that the server does not know (different file, never synced) to be silently skipped, so that sync never nags about it.
7. As a reader, I want sync failures (offline, bad credentials) to be silent while reading and visible as a last-error line in Settings, matching how S3 Sync reports.
8. As a reader using both S3 Sync and KOReader Sync, I want a position pulled from KOReader to propagate to my other Litera devices through S3 Sync, so that all my devices converge.
9. As a bilingual reader, I want all UI copy in English and Simplified Chinese.

## Implementation Decisions

- **Glossary**: add **KOReader Sync** to `CONTEXT.md` — "The opt-in feature that exchanges a Book's reading position with a kosync-compatible server (KOReader's sync server, BookOrbit, …). Progress only; separate from Sync." _Avoid_: Sync (that is the S3 feature), cloud sync. The server is a **Progress Server**.
- **Document hash**: computed in Rust from `book.epub` (stored verbatim at import, so it equals the original file) on every pull/push — it reads at most 12 KiB, so nothing is cached and the BookRecord and Manifest are untouched. Books whose `book.epub` is not cached are skipped.
- **Transport**: Rust module `kosync.rs` using the existing `reqwest` dependency plus the `md-5` crate. Commands: `get_kosync_config`, `save_kosync_config`, `test_kosync_connection`, `get_kosync_status`, `kosync_pull(bookId)` (returns the remote position plus the local `positionUpdatedAt`, falling back to `lastOpenedAt` like Sync), `kosync_push(bookId, progress, percentage)`. Requests time out after 10 s.
- **Credentials**: `kosync_config.json` in app data, plaintext like the S3 and LLM keys, never synced. Store `md5(password)` rather than the password (it is all the protocol needs). Fields: `enabled`, `serverUrl`, `username`, `userKey`, `deviceId`. Last sync time and last error live in memory for the current run and show in Settings.
- **Device identity**: `device: "Litera"`, `device_id`: a stable id generated on first save and kept in `kosync.json` (independent of S3 Sync). Pulls whose `device_id` equals ours are ignored.
- **Position conversion** lives in a pure module `src/lib/xpointer.ts`:
  - `xpointerFromRange(sectionDoc, range, spineIndex)` → element-level XPointer of the block containing the range start, with a text step + offset when it can be computed reliably.
  - `rangeFromXPointer(sectionDoc, xpointer)` → DOM Range, resolving element steps and clamping/ignoring an offset that does not fit.
  - The CFI ⇄ Range side uses foliate-js (`view.getCFI`, `resolveCFI`), already used by the reader.
  - Fallback: if an XPointer cannot be resolved, go to the pushed `percentage` as a book fraction; if a Range cannot be turned into an XPointer, push `/body/DocFragment[n]/body` (chapter start).
  - **Clean-room**: BookOrbit is AGPL-3.0. Its converter may be read to confirm protocol facts but no code is copied.
- **Push cadence**: after a relocate that moved the position (same rule as `positionUpdatedAt`), debounce ~10 s; flush on book close and on window close (reusing the S3 Sync close hook with a short timeout). Skip if the XPointer and rounded percentage equal the last pushed pair.
- **Pull & conflict rule**: on book open (after the local position is restored) pull once. Offer a jump when the remote record exists, `device_id ≠ ours`, `timestamp` (seconds) > local `positionUpdatedAt`, and the percentage differs by more than ~0.1 %. Litera asks first: a dialog "<device> is at 42% (you are at 17%). Jump there?" with Jump / Stay. Jump goes through the normal position write path, so it bumps `positionUpdatedAt` and reaches S3 Sync. Stay keeps the local position (the next push overwrites the remote).
- **Errors**: 401 → `lastError = invalid credentials`; network → silent retry on next trigger; 404 / `{}` → book unknown, silently skipped.

## Testing Decisions

- Rust: partial MD5 against a known vector (generate one fixture with KOReader's algorithm on files < 1 KiB, between offsets, and > 1 MiB); auth header construction; response parsing of `{}` vs full record.
- `xpointer.ts`: jsdom fixtures for unique vs repeated siblings, nested inline markup, text offsets, unresolved paths, and round-trip Range → XPointer → Range landing in the same block.
- Pull rule as a pure function (`shouldJump(local, remote, ownDeviceId)`) with table tests.
- Settings form test following `SyncSettingsForm.test.tsx` (mocked `invoke`).
- Manual check against a local `koreader-sync-server` (Docker) and a BookOrbit instance, plus KOReader on a device or the emulator.

## Out of Scope

- Annotation/highlight sync with KOReader or BookOrbit.
- KOReader's "filename" document-matching mode.
- Registering new accounts from Litera (`/users/create`) — users register in KOReader or BookOrbit.
- PDF/CBZ positions (Litera is EPUB-only).
- Pulling periodically while a book stays open (only on open; may revisit).

## Open Questions

1. (Resolved: ask first.)
2. (Resolved: yes. CREngine's `epubfmt.cpp` makes one DocFragment per spine itemref, non-linear included, and a placeholder fragment for items it cannot parse, so indexes never shift. Matches foliate's `book.sections`.)
