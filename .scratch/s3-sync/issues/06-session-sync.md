# 06: Session sync with branch preservation

**What to build:** A reader's assistant Sessions follow them across devices: conversations continue on another machine, including their summaries and per-session system prompts (which are appended to the default, so reading tools stay intact). When two devices each chatted about the same book in diverging directions, the merge keeps both branches — neither conversation is silently dropped, and the existing session branch UI can navigate them. Verifiable: chat about a book on one machine, sync both, continue that conversation on the other; chat divergently on two machines, sync, and both branches are present.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [x] Sessions created on one device appear and continue on another after sync
- [x] Session summaries and per-session system prompts sync along with the messages
- [x] Diverged Sessions keep both branches after merge; neither side's conversation is lost
- [x] API keys never sync (provider settings syncing is ticket 07; keys stay per-device)
- [x] Branch-preservation behavior covered by merge-engine tests; wiring covered by app-level tests

## Comments

- Sessions sync as whole-object files at `litera/sessions/<bookId>/<sessionId>.jsonl` (summaries and per-session system prompts are entries, so they ride along; the active-branch leaf sidecar stays per-device).
- Merge is an entry union by id (local order first, remote-only appended in remote order); diverged branches both survive and remain navigable via the existing leaf-switch UI. Change detection: content hash for uploads, backend etag from listing for downloads (sync-state `session_revisions`).
- API keys never sync: they live in agent auth.json which is not a session file.
- Expired book Tombstones purge their session objects along with book files.
- Tests: Rust (`sync_merge_tests`: branch preservation, unseen-session creation, summary/system-prompt retention, file enumeration) and runner-level (sync_sessions invoked after the manifest upload).
