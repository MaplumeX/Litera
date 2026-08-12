# Sidecar Protocol Audit Evidence

## Confirmed defects

- `sidecar/index.ts:447-479`: `handleBookOpened()` changes `currentBookId` but leaves `currentSessionId`; `handlePrompt()` then uses the stale session.
- `sidecar/index.ts:520-604`: readline starts every async handler without ordering or request correlation.
- `src-tauri/src/lib.rs:23-31,226-300`: sync commands hold `std::sync::Mutex` while writing/flushing a child pipe.
- `src-tauri/src/lib.rs:125-218`: protocol messages are decoded through scattered generic JSON field reads and re-emitted as unrelated global event names.
- `src/components/ChatPanel.tsx:114-269`: listeners are registered sequentially inside an async IIFE; cleanup cannot remove listeners whose promise resolves after unmount.
- `src/main.tsx:6-10`: StrictMode double effect lifecycle exposes the listener race in development.
- `src-tauri/src/lib.rs:561-563` and `sidecar/index.ts:453-454`: `book_ready` may be emitted before ChatPanel mounts and has no query/snapshot fallback.

## Required prevention mechanisms

- One typed decoder/encoder owner per side of the JSONL boundary.
- Correlation IDs plus process generation and monotonic frontend version.
- Explicit state machine and race regression tests, not UI timing assumptions.
- Bounded command queues and non-blocking Tauri commands.
- Snapshot hydration after listener registration.
