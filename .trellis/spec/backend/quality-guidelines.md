# Quality Guidelines

## Embedded Agent boundary

- `LiteraAgentRuntime` is the only Agent loop. One active book worker, session,
  and prompt are allowed at a time.
- Provider imports must remain browser-compatible and pinned to the matching
  `pi-ai` / `pi-agent-core` version.
- The raw user message is appended before the network call. Completed assistant
  and tool-result messages are appended only after settlement.
- Abort persists the terminal aborted assistant message when Pi settles.

## Book tools and coordinates

- `chapterIndex` always indexes the TOC-owned chapter projection, never raw spine
  files. The reader sends `chapterHref`; the runtime resolves ownership.
- `read_chapter` is bounded by 12,000-character parts. Search accepts multiple
  query variants, prefers exact hits, and returns deterministic bounded snippets.
- EPUB parsing, ownership, indexing, and search run in the module worker. A book
  switch terminates the old worker and rejects pending calls.

## Session integrity

- Pi v3 JSONL remains append-only during normal interaction.
- Rust validates real paths, ids, timestamps, parents, byte caps, and expected
  leaves. Stale writers fail rather than silently forking.
- Only an invalid trailing fragment may be truncated. Earlier corruption is an
  error. v1/v2 migrations require a backup and atomic replacement.

## Network and credentials

- Model requests use `createGuardedNativeFetch`, require the configured HTTP(S)
  origin, and reject redirects.
- API keys exist only in Rust-owned config files and request memory. Never put
  them in local storage, sessions, logs, errors, or snapshots.

## Required gates

Run frontend tests/type-check/build, Rust tests, `tauri build --no-bundle`, and
the stale-reference audit before release.
