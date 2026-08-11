# Quality Guidelines

> Code standards for the Litera Rust backend + Node.js sidecar.

---

## Sidecar stdio JSON Lines Protocol

### Convention: sidecar stdout MUST only emit JSON lines

**What**: The sidecar process communicates with Rust via stdout. Every line must be a valid JSON object. No non-JSON output on stdout.

**Why**: Rust reads sidecar stdout with `BufReader::lines()` and parses each line as JSON. Non-JSON lines (e.g., from `console.log`) break the parser.

**Correct**:
```typescript
// sidecar/index.ts
function send(obj: object) {
  process.stdout.write(JSON.stringify(obj) + "\n")
}
send({ type: "text_delta", delta: "hello" })
```

**Wrong**:
```typescript
// NEVER do this in sidecar
console.log("processing prompt")  // breaks Rust JSON parser
console.error("debug info")       // use process.stderr for diagnostics
```

**Rule**: Use `process.stdout.write(JSON.stringify(obj) + "\n")` for all protocol output. Use `process.stderr.write()` for diagnostics (Rust logs stderr separately).

### Convention: sidecar is a long-running process

**What**: `node sidecar/dist/index.js` blocks forever waiting for stdin input. It never exits on its own.

**Why**: The sidecar is a stdio server. It reads stdin line-by-line and processes prompts.

**Implication for testing**: Do NOT run `node dist/index.js` directly in tests or CI — it will hang. Only verify via `tsc --noEmit` (compile check) and static code review. Runtime verification requires the Tauri app to spawn it with piped stdin/stdout.

## Sidecar Process Management (Rust)

### Convention: spawn in setup, kill on window destroy

```rust
// Spawn in tauri::Builder::default().setup()
let mut child = Command::new("node")
    .arg("sidecar/dist/index.js")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()?;

// Kill on window destroy
.on_window_event(|window, event| {
    if let WindowEvent::Destroyed = event {
        // kill sidecar child
    }
})
```

### Convention: read stdout in separate thread

```rust
let stdout = child.stdout.take().unwrap();
std::thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let line = line.unwrap();
        // parse JSON, app.emit("agent_*", payload)
    }
});
```

**Why**: Reading stdout is blocking. Must be on a separate thread to avoid freezing the Tauri event loop.

### Don't: block the main thread on sidecar I/O

**Problem**: Reading sidecar stdout synchronously in a command handler.

**Why it's bad**: Blocks the Tauri event loop, freezing the UI.

**Instead**: Always use `std::thread::spawn` for stdout reading. Write to stdin from command handlers (fast, non-blocking).