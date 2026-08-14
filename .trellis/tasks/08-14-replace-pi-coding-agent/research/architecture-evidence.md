# Architecture Evidence

## Repository evidence

- `sidecar/index.ts` uses `createAgentSession`, `SessionManager`,
  `DefaultResourceLoader`, and `defineTool` from `pi-coding-agent`.
- `sidecar/book.ts` and `book-worker.ts` additionally own EPUB parsing, TOC-owned
  chapter construction, FTS5 search, and worker-thread isolation.
- `src-tauri/src/sidecar.rs` owns process startup, bounded queues, JSONL framing,
  recovery, replay, and the Tauri command surface.
- `src/lib/use-agent-bridge.ts` and `agent-reducer.ts` expose the user-visible
  chat/session contract and correlate book, session, prompt, and tool events.
- `src-tauri/src/agent_config.rs` already owns Litera-specific provider, model,
  and API-key files under the app data directory.

## Upstream and reference evidence

- Current Pi separates the general runtime (`pi-agent-core`) and provider layer
  (`pi-ai`) from the coding-agent CLI/session/config layer.
- `pi-agent-core` `Agent` exposes serializable message state, subscriptions,
  `prompt()`, `abort()`, reset, and tool lifecycle events, but no Litera session
  store or coding-agent configuration loader.
- ReadAware directly depends on `@earendil-works/pi-agent-core` and
  `@earendil-works/pi-ai`, caches thread runtimes in WebView TypeScript, injects
  a host HTTP transport, and keeps persistence/search behind domain ports.
- `pi-ai` has browser-compatible import work, but its package still includes
  provider dependencies with Node-oriented paths and declares a Node engine.
  Therefore a real Vite + Tauri streaming spike is a mandatory gate before the
  old sidecar is removed.

## Planning conclusions

- Replacing the SDK is feasible, but `SessionManager`, model resolution,
  persistence, EPUB tooling, cancellation/error projection, and process recovery
  all require explicit replacements.
- A Web Worker can preserve off-main-thread EPUB parsing and search without an
  independent process. It is not a Tauri external binary or OS sidecar.
- Rust should remain the authority for credentials and durable append-only JSONL session files.
  The WebView receives only the active runtime configuration and holds the key
  in memory for the lifetime of the runtime.
- Pi's session v3 schema is public, documented, versioned, and already stores
  `pi-agent-core` `AgentMessage` values in an append-only `id`/`parentId` tree.
  Reusing that disk format avoids migration and preserves existing branches.
- The Node `SessionManager` implementation is the incompatible part: it imports
  Node filesystem/path/readline/crypto APIs and lives in `pi-coding-agent`.
  Litera can implement the same v3 storage semantics across Rust + WebView
  without retaining that package at runtime.
