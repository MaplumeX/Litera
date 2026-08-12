# Logging Guidelines

> How logging works in Litera. This project has **no structured logging framework** — logging is via `eprintln!` (Rust stderr) and `process.stderr.write()` (sidecar). Diagnostics are intentionally minimal.

---

## Overview

Litera does not use a logging framework like `tracing`, `env_logger`, or `winston`. All diagnostic output goes to stderr via the simplest available mechanism. The sidecar's stdout is reserved exclusively for the JSON lines protocol (see `quality-guidelines.md`).

Reference files:
- `src-tauri/src/lib.rs` — `eprintln!("[sidecar] ...")` calls
- `sidecar/index.ts` — `process.stderr.write()` (not used directly; diagnostics go through error protocol messages)

---

## Log Channels

### Rust backend: `eprintln!` to stderr

All Rust diagnostic logging uses `eprintln!` with a `[sidecar]` or `[sidecar stdout/stderr]` prefix.

```rust
// src-tauri/src/lib.rs
eprintln!("[sidecar] Failed to start: {e}");
eprintln!("[sidecar stdout] read error: {e}");
eprintln!("[sidecar] non-JSON stdout line: {line} ({e})");
eprintln!("[sidecar] unhandled message type: {other}");
```

### Sidecar: protocol error messages (not stderr)

The sidecar does NOT write diagnostics to `process.stderr` directly. Instead, errors are sent as protocol messages to Rust, which forwards them as Tauri events:

```typescript
// sidecar/index.ts
function sendError(message: string): void {
  sendMessage({ type: "error", message });  // goes to stdout as JSON line
}
```

Rust then emits these as `agent_error` Tauri events to the WebView:

```rust
// src-tauri/src/lib.rs — forward_sidecar_event()
"error" => {
    let message = parsed.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error").to_string();
    let _ = app.emit("agent_error", serde_json::json!({ "message": message }));
}
```

### Frontend: `console.error` for development

The React frontend uses `console.error` for error logging. These appear in the WebView devtools console, not in any persistent log.

```typescript
// src/components/LibraryView.tsx
console.error("list_books error:", err);
console.error("import error:", err);
```

---

## Log Levels (Informal)

There are no formal log levels. The conventions are:

| Situation | Mechanism |
|-----------|-----------|
| Expected error (sidecar startup failure) | `eprintln!("[sidecar] ...")` in Rust |
| Protocol violation (non-JSON stdout) | `eprintln!("[sidecar] non-JSON ...")` in Rust |
| Sidecar runtime error | `sendError(message)` → `agent_error` event → frontend UI |
| Frontend invoke failure | `console.error` + user-facing `alert()` |

---

## What to Log

- Sidecar process lifecycle events (spawn success/failure, window destroy kill).
- Sidecar stdout parse errors (non-JSON lines, unhandled message types).
- Sidecar stderr lines (forwarded as-is with `[sidecar stderr]` prefix).
- Tauri command failures (returned as `Err(String)` to the WebView).

## What NOT to Log

- **User prompt content** — prompts contain user reading selections; do not log them.
- **EPUB content** — book text is copyrighted; never log chapter contents.
- **Session history** — JSONL session files are private; do not log their contents.

---

## Don't: add a logging framework unless the project grows

The current `eprintln!` + `sendError` approach is deliberately minimal. Do not introduce `tracing` or `env_logger` unless the sidecar or backend grows complex enough to justify structured logging. If you do, update this file with the chosen framework and migrate all existing `eprintln!` calls.

## Don't: use `console.log` in the sidecar

The sidecar's stdout is a JSON lines protocol channel. `console.log` writes to stdout and would break the Rust JSON parser. See `quality-guidelines.md` for details.