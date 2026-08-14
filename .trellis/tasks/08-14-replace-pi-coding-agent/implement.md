# Implementation Plan

## Gates and order

- [x] 1. Record the green baseline: root frontend tests/build, Rust tests, sidecar
  tests/smoke, and current desktop prompt/session behavior.
- [x] 2. Browser/Tauri spike: add matching Pi core/AI packages in the root,
  construct one tool-calling Agent with the active custom provider, inject the
  Tauri native transport, prove Vite production build plus live streaming and
  abort. Stop and revise the design if this gate fails; do not remove sidecar.
- [x] 3. Add Pi session v3 types/fixtures, the central frontend decoder/branch
  projector, and Rust `PiSessionStore`: existing-directory list/load, header-only
  create, per-session serialized append, expected-leaf compare, delete, and
  book-delete cleanup. Test messages/tool results, session_info, custom_message,
  compaction/branch summary, unknown known entries, corrupt/truncated tail,
  symlink, caps, stale leaf, concurrent append, and crash reopen.
- [x] 4. Add v1/v2 → v3 migration with backup + atomic rewrite. Add bidirectional
  compatibility gates: pinned legacy `SessionManager` opens new-writer fixtures,
  and the new reader opens current Litera/Pi v3 fixtures without data loss.
- [x] 5. Port book ownership/window/search pure helpers into `src/agent/book/`.
  Add the browser-safe EPUB module worker and typed RPC client; test cover +
  split-chapter ownership, empty TOC fallback, cancellation, book supersession,
  and multi-query search.
- [x] 6. Implement `get_agent_runtime_config`, stable model resolution, and the
  guarded native-fetch adapter. Test built-in and custom provider config,
  origin rejection, redacted errors, and config invalidation.
- [x] 7. Implement `LiteraAgentRuntime`: Pi Agent construction, compaction-aware
  active-branch projection, 12-turn hydration, reading-context injection, tools,
  event normalization, prompt/abort/error flow, pre-network user-message append,
  and settlement-time assistant/tool-result batch append.
- [x] 8. Replace the sidecar bridge/reducer contracts with the local runtime
  controller. Preserve ChatPanel behavior for streaming, tool steps, sessions,
  rename/delete/new/switch, edit-resend, selection context, and navigation.
  Remove restart actions and sidecar-specific statuses/copy.
- [x] 9. Decouple `open_book_bytes` from sidecar notification. Feed a safe copy of
  opened EPUB bytes plus reader metadata/locator into the book worker; ensure
  rapid A/B opens and leaving the reader abort/terminate only the old runtime.
- [x] 10. Run full feature tests and a desktop manual matrix before removal:
  built-in provider, custom OpenAI-compatible endpoint, streaming, tool call,
  abort, edit, session CRUD, app restart, v1/v2 migration, corrupt legacy
  file, rapid book switch, and reader survival after Agent failure.
- [x] 11. Remove sidecar source, Rust supervisor/protocol, external binary config,
  root scripts, release CI steps, lock/version coupling, and sidecar-only deps.
  Update README/CHANGELOG and project specs to the new runtime/storage contracts.
- [x] 12. Run the final clean-checkout/release-equivalent gate and verify no tracked
  or generated `litera-sidecar`, `pi-coding-agent`, `restart_sidecar`, stale JSONL
  protocol, or sidecar release reference remains.

## Validation commands

```text
npm test -- --run
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --no-bundle
rg -n "pi-coding-agent|litera-sidecar|restart_sidecar|build:sidecar|smoke:sidecar" \
  package.json package-lock.json src src-tauri scripts .github README.md CHANGELOG.md
```

During the spike and final manual gate, run a real model request from the Tauri
desktop app; jsdom and Vite build alone do not prove native streaming transport.

## Rollback points

- After step 2: remove root Pi/native-transport spike dependencies; current
  sidecar remains untouched.
- After steps 3-8: embedded runtime/storage can be reverted because all new writes
  remain in the existing Pi v3 files and pass the legacy-reader compatibility gate.
- Step 11 is the destructive code-removal boundary and occurs only after the
  desktop behavior matrix passes. Git restores removed code; user old-session
  files remain preserved by design.

## Review gates

- Verify the spike imports no Node-only provider path into the browser bundle.
- Verify every raw Rust/JSONL message payload is decoded in one frontend boundary;
  Rust separately validates only the filesystem/envelope/append trust boundary.
- Verify no API key reaches logs, errors, localStorage, transcript JSON, or test
  snapshots.
- Verify EPUB `script-src` remains unchanged and no WebView filesystem/shell
  permission is added.
- Verify the shared Pi session root is deleted with a book, v1/v2 migration keeps
  a backup, and ordinary v3 operations never rewrite existing history.
