# Android app via Tauri 2 mobile, sharing one codebase with desktop

Litera is getting an Android app that works as a full, standalone reader: it imports its own books and uses the assistant on its own, and Sync is optional. We decided to build it on Tauri 2's Android target in the same repository, not as a native Kotlin app or with another cross-platform stack. The main reason is that the Sync merge semantics (ADR 0001), the Library store, KOReader Sync, and the agent runtime then exist exactly once. Two implementations of the Manifest merge would drift apart and corrupt each other's data.

## Consequences

- Rust code that only works on desktop is gated with `cfg` and gets Android counterparts: system font enumeration (`font-kit`), single-instance, window state, file associations, and path-based "Open with".
- On Android the UI is a separate mobile shell (page stack, bottom-sheet assistant, touch gestures). It reuses `lib/`, `agent/`, foliate-js and the UI primitives, but not the desktop panel layout. Wide screens such as tablets keep the desktop shell.
- Features that need platform APIs the WebView lacks (read-aloud via `speechSynthesis`, volume-key page turns, intents) need small native Tauri plugins. Read-aloud is deferred for this reason.
- Imported books on Android have no stable source path, so content-derived Book ids are the only way to detect duplicates there. Path-based `source_key` overwrite is desktop-only.
- We accept a WebView-rendered reader instead of a native one. Its scrolling and gesture feel has to be tuned in the mobile shell rather than coming for free.
