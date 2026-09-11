# Spec: Sync (S3-compatible cloud sync)

Status: ready-for-agent

## Problem Statement

A Litera user reads on more than one machine (e.g. a desktop and a laptop, or an old and a new computer). Today every piece of state lives only on the machine that created it: the Library, reading positions, Annotations, assistant Sessions, and the EPUB files themselves. Moving between devices means manually re-importing books, losing reading progress, and losing highlights and notes. There is no way to keep two installations of Litera convergent.

## Solution

An opt-in Sync feature backed by a Sync Backend the user configures: any S3-compatible object store (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Synology C2, ...) with custom endpoint, region, and path-style addressing. Litera runs no server and stores nothing on behalf of users.

When enabled, Sync mirrors the Library and Sessions across devices: book files and covers, reading positions, Annotations, and assistant Sessions (including summaries and per-session system prompts). Data is stored on the Sync Backend in plaintext — no client-side encryption. LLM provider API keys and S3 credentials never leave the device.

The privacy promise is updated accordingly: books stay on your machine until you enable Sync; the first time Sync is enabled the UI states plainly that synced data is stored as-is on the bucket the user chooses.

Merges are item-level, not whole-database: Annotations merge by id union, reading positions take the newest `updated_at` (ties broken by device id), branched Sessions keep both branches. Deletions propagate via Tombstones kept for 30 days. The local trash never syncs.

## User Stories

1. As a reader with two computers, I want to enable Sync by pointing Litera at my own S3-compatible bucket, so that I don't need an account with any Litera-run service.
2. As a privacy-conscious reader, I want Sync to be strictly opt-in and off by default, so that my books and notes stay on my machine unless I decide otherwise.
3. As a reader, I want to enter endpoint, region, bucket, path-style toggle, access key, and secret in Settings, so that any S3-compatible provider works.
4. As a reader, I want a "test connection" affordance when configuring the Sync Backend, so that I can catch typos before relying on Sync.
5. As a reader, I want to see whether Sync is enabled, when it last ran, and whether the last run succeeded, so that I can trust the feature is actually working.
6. As a reader, I want a manual "Sync now" button, so that I can force a sync on demand or after fixing a configuration error.
7. As a reader, I want Sync to run automatically at app startup, so that a fresh session starts converged.
8. As a reader, I want local edits to be pushed after a short debounce, so that frequent changes (page turns) don't spam the backend yet converge quickly.
9. As a reader, I want periodic background sync (on the order of minutes), so that a long-running reading session stays converged without my intervention.
10. As a reader, I want reading positions to sync, so that I can continue on another device exactly where I stopped.
11. As a reader, I want to see an upload-size estimate before my existing library is first bulk-uploaded, so that I can decide whether to proceed knowing the storage and traffic cost.
12. As a reader, I want EPUB uploads to use multipart with resume, so that a large book over a flaky connection eventually makes it.
13. As a reader on a new device, I want the Manifest to be pulled immediately on first sync, so that my shelf (titles, covers metadata, progress, Annotations) renders within seconds.
14. As a reader on a new device, I want EPUB files and covers downloaded on demand when I open a book or view its cover, so that I don't wait for a full-library download.
15. As a reader on a constrained connection, I want books that are not yet downloaded to be clearly marked (an "not cached" state on the book card), so that I know why a book can't be opened offline.
16. As a reader, I want downloaded books cached locally, so that reopening a synced book works offline.
17. As a reader, I want my Annotations (bookmarks, highlights, notes) to sync, so that my marginalia follows me across devices.
18. As a reader who highlights on two offline devices, I want Annotations to merge by id union when both come online, so that neither device's highlights are lost.
19. As a reader who deleted a single highlight, I want that deletion to propagate, so that the highlight isn't resurrected by a merge on another device.
20. As a reader who deletes a book on one device, I want the deletion to propagate to my other devices via a Tombstone, so that the book doesn't reappear.
21. As a reader who deleted a book by mistake, I want the Tombstone to survive 30 days, so that a rarely-used device still learns of the deletion (and the local trash gives me a recovery window on the device that deleted it).
22. As a reader, I want my assistant Sessions (including summaries and per-session system prompts) to sync, so that conversations continue on another device.
23. As a reader who chatted on two devices about the same book, I want diverged Sessions to keep both branches, so that neither conversation is silently dropped.
24. As a reader, I want my typography and reader preferences to sync, so that my reading experience is identical across devices.
25. As a reader, I want my app preferences (language, theme, UI font) to sync, so that a new device feels configured.
26. As a reader, I want my LLM provider settings (provider choice, model, custom endpoints) to sync but not the API keys, so that I re-enter keys once per device and everything else follows.
27. As a reader, I want book metadata edits (title, author, cover) to sync, so that my curation effort isn't device-local.
28. As a reader, I want sync conflicts on the Manifest to be retried automatically (conditional PUT, re-fetch, re-merge), so that simultaneous syncs on two devices don't lose data.
29. As a reader, I want sync failures to retry silently, so that transient network errors don't interrupt my reading.
30. As a reader, I want repeated sync failures to surface as a non-blocking toast after several consecutive failures, so that I'm alerted without being nagged per failure.
31. As a reader, I want the sync status to be inspectable in Settings rather than in my face, so that reading is never interrupted by sync UI.
32. As a reader using R2/B2/MinIO with non-AWS endpoints, I want custom endpoint and path-style options honored, so that my provider works.
33. As a reader who syncs, I want my S3 credentials stored locally like my LLM API keys, so that I understand where they live (plaintext local JSON, per current app conventions).
34. As a bilingual reader, I want all Sync UI in both English and Simplified Chinese, so that the feature matches the rest of the app.
35. As a new device joining with an empty local library, I want the first sync to download rather than upload, so that my library appears instead of clobbering the backend.

## Implementation Decisions

- Follows ADR `docs/adr/0001-s3-sync.md` and the glossary in `CONTEXT.md` (Library, Book, Annotations, Session, Sync, Sync Backend, Manifest, Tombstone). Use those terms in code and UI copy.
- **Scope of synced data**: book files, covers, reading positions, Annotations, Sessions (with summaries and per-session system prompts), app preferences, LLM provider settings. **Never synced**: LLM API keys, S3 credentials, local trash contents.
- **Backend**: user-configured S3-compatible object store. Rust-side client via the `object_store` crate (not `aws-sdk-s3`), supporting custom endpoint, region, and path-style.
- **Cloud layout**: a single `manifest.json` object holds all small data — book metadata, per-book reading positions, Annotations, Tombstones, and per-item timestamps with device ids. EPUB files and covers are separate objects referenced by revision from the Manifest. One GET yields the full merge state; merge runs in memory.
- **Concurrency**: Manifest uploads use conditional PUT (`If-Match` on the current etag). On etag mismatch, re-GET, re-merge, and retry a bounded number of times before surfacing an error.
- **Merge semantics** (pure function core):
  - Annotations: union by annotation id; per-item deletion via Tombstone (a deleted id wins over a live id, until the Tombstone expires).
  - Reading position: newest `updated_at` wins; ties broken by device id. Timestamps must be explicit recorded fields, never file mtime.
  - Sessions: diverged branches are both kept (branching semantics already exist in the chat model).
  - Book deletion: Tombstone in the Manifest, retained 30 days; any device may opportunistically purge expired Tombstones.
  - An empty local library joining an existing backend downloads rather than uploads (bootstrap direction is decided by comparing manifest state, not by "who has more books").
- **Sync cadence**: automatic (startup, debounced after local changes, periodic on the order of minutes) plus a manual "Sync now" button.
- **Failure handling**: silent retry; non-blocking toast only after several consecutive failures. Sync UI confined to Settings (status, last-run time, error text) and never interrupts reading.
- **First-sync UX**: an upload-size estimate confirmation before bulk-uploading an existing library; thereafter new imports upload automatically.
- **New-device UX**: Manifest pulled immediately so the shelf renders instantly; EPUBs and covers fetched on demand and cached locally; book cards show a "not cached" state for books whose file isn't local.
- **Credentials**: S3 access key and secret stored in local plaintext JSON, same treatment as existing LLM API keys (`auth.json` conventions). No keychain integration.
- **Plaintext**: no client-side encryption. README privacy statement rewritten; first-enable UI states the tradeoff once.
- **Rust/Tauri**: new sync commands follow existing command registration patterns; sync module in `src-tauri/src/`.
- **UI**: a Sync section in the Settings dialog (endpoint, region, bucket, path-style, access key, secret, test connection, enable/disable, "Sync now", last sync status/time). UI copy via the existing i18n mechanism, English and Simplified Chinese.
- **Implementation order**: (1) merge core as pure functions, (2) S3 thin wrapper, (3) Tauri commands, (4) UI + README/i18n updates.

## Testing Decisions

- Good tests assert external behavior only (what a user or calling layer observes), never implementation details.
- **One new seam: the merge engine as pure TS functions** in the frontend lib layer, completely unaware of S3 and Tauri. Covers: Manifest model round-trip, position newest-wins and tie-break, Annotations union with Tombstones, book-deletion Tombstone propagation and 30-day expiry, Session branch preservation, bootstrap direction (empty device downloads). Prior art: `library-shelf.ts` / `annotations.ts` / `reader-progress.ts` tests — same colocated vitest pattern.
- **Rust inline unit tests** (`#[cfg(test)]`) for the sync module: Manifest serialization round-trip, etag conditional-PUT retry loop, object path layout. Prior art: `library.rs` / `agent_config.rs` test modules. Real S3 traffic is manual (no network-layer test precedent in the repo).
- **App/component tests** in the existing `App.*.test.tsx` style (jsdom + RTL, mocked `invoke`): Sync settings render and save, "Sync now" invokes the right command, "not cached" card state visible, failure toast appears only after the configured number of consecutive failures.
- S3 interactions are NOT given a TS seam; they live entirely behind Tauri commands.

## Out of Scope

- Client-side encryption of synced data.
- Any Litera-operated backend, accounts, or billing.
- Syncing the local trash.
- Mobile clients.
- Selective sync (choosing which books sync).
- Conflict-resolution UI (merges are automatic; no manual merge dialogs).
- Bandwidth throttling or scheduling windows.
- Migration of users from any pre-existing sync system (none exists).

## Further Notes

- The Manifest/Tombstone/merge vocabulary is codified in `CONTEXT.md`; the architecture decision is recorded in `docs/adr/0001-s3-sync.md`. Implementation should keep those documents authoritative and update them if terms drift.
- README privacy statement rewrite ("books stay on your machine until you enable Sync; synced data is stored as-is on the bucket you choose") is part of this feature's deliverables, in both English and Simplified Chinese READMEs.
