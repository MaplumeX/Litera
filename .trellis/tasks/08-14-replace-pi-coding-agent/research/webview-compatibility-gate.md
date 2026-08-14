# WebView compatibility gate

## Automated evidence (2026-08-14)

- Baseline before the spike: frontend 170 tests, Rust 129 tests, sidecar 8 test
  files, sidecar smoke, and the production Vite build all passed.
- Root dependencies pin `@earendil-works/pi-ai` and
  `@earendil-works/pi-agent-core` to the legacy runtime's matching `0.84.1`.
- The embedded product runtime imports the exact `Agent` and provider paths.
  The production Vite graph builds successfully (3284 transformed
  modules), proving these paths are browser-bundle compatible rather than only
  type-resolvable.
- A Pi faux-provider integration test proves streamed message events, tool
  execution, tool-result insertion, and abort settlement in the WebView test
  environment.
- The guarded adapter uses `@tauri-apps/plugin-http`, rejects non-HTTP(S) and
  non-active origins, disables redirects, and replaces native errors with a
  credential-free message. Rust plugin registration, capability generation,
  `cargo test --locked`, and `tauri build --no-bundle` pass.
- The completed non-destructive implementation passes 186 frontend tests, 140
  Rust tests, 9 legacy-sidecar test files, the no-Node sidecar smoke, Vite build,
  and Tauri no-bundle build. Browser fixtures cover EPUB 3 nav, EPUB 2 NCX,
  empty-TOC fallback, split ownership, cancellation, and multi-query search.

## Manual gate passed (2026-08-15)

The user verified the real Tauri window with the existing provider setup:
default rollback behavior worked, then enabling the embedded runtime produced a
real streamed answer and cancellation worked without disrupting the configured
provider. This approved the destructive removal boundary.

The embedded runtime is now the only product path. The old executable source,
supervisor/protocol commands, external binary configuration, shell integration,
build/release coupling, and generated executable were removed. Pi v3 user session
files remain in place and compatible by design.
