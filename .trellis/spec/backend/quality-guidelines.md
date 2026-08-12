# Quality Guidelines

> Code standards for the Litera Rust backend + Node.js sidecar.

---

## Sidecar stdio JSON Lines Protocol

### Convention: sidecar stdout MUST only emit JSON lines

**What**: The sidecar process communicates with Rust via stdout. Every line must be a valid JSON object. No non-JSON output on stdout.

**Why**: Tauri shell events deliver arbitrary stdout byte chunks. Rust's `JsonLineFramer` reassembles newline-delimited frames before parsing JSON. Non-JSON lines (e.g., from `console.log`) still break the protocol.

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

**What**: the packaged `litera-sidecar-$TARGET_TRIPLE[.exe]` blocks waiting for stdin input. It does not require a system Node.js runtime.

**Why**: The sidecar is a stdio server. It reads stdin line-by-line and processes prompts.

**Implication for testing**: do not launch the executable without a harness. `npm run smoke:sidecar` spawns it with pipes, removes Node from `PATH`, waits for `ready`, sends `ping`, and requires `pong` after a real FTS5 WASM query.

## Sidecar Process Management (Rust)

### Convention: resolve through Tauri, spawn in setup, kill on window destroy

```rust
// Spawn in tauri::Builder::default().setup()
let (events, child) = app
    .shell()
    .sidecar("litera-sidecar")?
    .set_raw_out(true)
    .spawn()?;

// Kill on window destroy
.on_window_event(|window, event| {
    if let WindowEvent::Destroyed = event {
        // kill sidecar child
    }
})
```

The WebView capability file does not grant shell execute/spawn permissions. The fixed external-binary name is selected only by Rust.

### Convention: frame raw chunks and serialize writes through one owner

```rust
tauri::async_runtime::spawn(async move {
    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(chunk) => {
                for line in stdout_framer.push(&chunk) {
                    let event = EventEnvelope::decode_line(&line)?;
                    event_bridge.try_send(event)?;
                }
            }
            // stderr, Error, and Terminated are handled explicitly
            _ => {}
        }
    }
});
```

`CommandChild` is owned by a background writer thread. Command handlers enqueue complete JSONL byte frames; they never perform `ChildStdin::write_all` or `flush` while holding Tauri state on the main thread.

### Convention: terminal events update transport status

- stdin write failure, invalid stdout, bridge overflow, ready timeout, `CommandEvent::Error`, and unexpected `CommandEvent::Terminated` become `ProcessEnded` for exactly one process generation.
- The supervisor first updates its snapshot and emits `prompt_interrupted`/`supervisor_status`, then performs bounded recovery. Exhaustion becomes `unavailable`; `restart_sidecar` starts a fresh recovery budget.
- Intentional window shutdown marks the actor as stopping before sending the dedicated kill signal, so the expected termination cannot start another recovery loop.
- Old-generation events remain harmless even if a terminated process reports late output; the actor rejects them before updating the snapshot.

### Convention: use the versioned typed agent envelope

- Every command contains `protocolVersion: 1`, `requestId`, and the relevant `bookId`, `sessionId`, or `promptId` correlation.
- Every sidecar event contains `protocolVersion: 1` and a positive process-local `seq`. Rust rejects duplicate or regressing `seq` values, then adds the process `generation` and global monotonic `version` before emitting the single `agent_event` channel.
- Decode `unknown` JSON exactly once in `sidecar/protocol.ts` and `src-tauri/src/sidecar_protocol.rs`. Consumers must not read raw JSON fields independently.
- JSONL commands/events, identifiers, prompt text, selection text, and stdout framing have explicit size limits. Validation happens before a Tauri command returns a receipt.

### Convention: sidecar agent config is injected, never host-borrowed

- The sidecar MUST NOT read `~/.pi/agent` or `process.env.HOME` to locate LLM provider/auth/models config. The Rust supervisor owns a Litera-specific agent config directory (`<app_data_dir>/agent/`) and injects it via the `configure` command after every `ready` event, before any `open_book`.
- Rust resolves and `create_dir_all`s the agent dir once at supervisor startup and stores it on `SupervisorActor.agent_dir`; it re-sends `configure` on every `ready` (including restarts) so a freshly spawned sidecar always receives it before replay.
- The sidecar stores the injected path in a module-level `agentDir` variable. `handleOpenBook` rejects if `agentDir` is unset. `makeResourceLoader` and every `createAgentSession` call MUST pass `agentDir` explicitly — the pi SDK's `createAgentSession` falls back to `getDefaultAgentDir()` (~/.pi/agent) when `agentDir` is omitted even if a `resourceLoader` is supplied, so omitting it silently re-couples Litera to the host pi install.
- `configure` is fire-and-forget (no confirmation event); delivery ordering is guaranteed because Rust writes `configure` and any subsequent `open_book` to the same stdin writer synchronously.

### Convention: supervisor queues and recovery are bounded

- Tauri commands use a bounded supervisor queue; the supervisor uses a bounded child-writer queue. Full queues fail immediately with an operation-correlated error. `open_book_bytes` additionally waits on a one-shot actor completion from a blocking worker and returns EPUB bytes only after the child-writer queue accepts `open_book`. Process kill uses a separate capacity-one channel, and the child owner checks it before every normal write, so shutdown/restart never waits behind a full writer queue.
- The async stdout reader never blocks a Tauri runtime worker on `SyncSender::send`: it uses a bounded event bridge serviced by a dedicated thread. Overflow is terminal and causes a deterministic restart.
- Node respects stdout backpressure with its own frame/byte-bounded queue. If the Rust reader remains stalled and that queue fills, the sidecar terminates so the supervisor can recover instead of allowing Node's writable buffer to grow without bound.
- Any malformed, unknown, or otherwise invalid stdout protocol line is terminal for that process generation: Rust emits `ProcessEnded`, kills the child, and enters bounded restart instead of logging and continuing with an untrustworthy stream.
- Each process start receives a new generation and a ready watchdog aligned with the packaged smoke budget. Consecutive failures consume one bounded restart budget; receiving `ready` alone does not reset that budget.
- Recovery replays only the last controlled book descriptor and persisted active session. It never replays an interrupted prompt, and replay is enabled only after a process failure/manual restart, not on the first start.
- EPUB/FTS work lives in `BookWorker`. Its RPC requests are serialized, bounded, and carry `bookId` plus book generation; tools capture that pair when their session is created so an aborted old prompt cannot read a newer book. Each `open_book` replaces the worker before starting its load, and `close_book` detaches it; superseded workers terminate asynchronously so a slow A load cannot delay B or close.

### Don't: block the main thread on sidecar I/O

**Problem**: Reading sidecar stdout synchronously in a command handler.

**Why it's bad**: Blocks the Tauri event loop, freezing the UI.

**Instead**: consume shell events on Tauri's async runtime, frame stdout chunks there, and enqueue stdin writes to the dedicated child owner.

## Scenario: Packaged External Sidecar

### 1. Scope / Trigger

Apply this contract whenever the sidecar entry, dependencies, WASM assets, target matrix, or Tauri bundle configuration changes. It prevents development-only source paths or a system Node installation from becoming hidden release requirements.

### 2. Signatures

```text
npm run build:sidecar              # build the native host executable
npm run smoke:sidecar              # empty-PATH ready/ping/FTS5 probe
node sidecar/scripts/build.mjs --target <rust-triple>
bundle.externalBin = ["binaries/litera-sidecar"]
app.shell().sidecar("litera-sidecar")
```

### 3. Contracts

- Build output is `src-tauri/binaries/litera-sidecar-$TARGET_TRIPLE[.exe]`; generated binaries, `sidecar/dist`, and the pkg cache remain untracked.
- esbuild emits the CommonJS entry and copies `sql-wasm.wasm`; `@yao-pkg/pkg` embeds both into a self-contained executable. Keep pkg compression disabled because compressed source snapshots fail to read the WASM with the pinned pkg version.
- An explicit target comes from `--target`, `TAURI_TARGET_TRIPLE`, `TAURI_ENV_TARGET_TRIPLE`, or `CARGO_BUILD_TARGET`. A requested non-host target fails and must be built on that native OS/architecture runner.
- Rust alone resolves the fixed external binary. WebView capabilities do not grant shell execute/spawn permissions.

### 4. Validation & Error Matrix

| Condition | Required result |
|-----------|-----------------|
| Unsupported Rust triple | Build fails with the supported target list |
| Explicit target differs from native host | Build fails; no relabeled host artifact |
| pkg/esbuild/WASM dependency missing | Locked `npm ci` is attempted, then failure propagates |
| Output missing or implausibly small | Build fails before Tauri packaging |
| Executable needs system Node or cannot load FTS5 | Empty-PATH smoke fails |
| Child write/error/termination | Transport becomes `Stopped(reason)` and later commands reject |

### 5. Good/Base/Bad Cases

- **Good**: fresh checkout root build creates the triple-suffixed executable, Tauri copies it into the release output, and empty-PATH FTS5 smoke passes.
- **Base**: local `npm run dev` rebuilds the native sidecar through `predev` and uses the same JSONL protocol as production.
- **Bad**: production resolves `sidecar/dist/index.js` with `CARGO_MANIFEST_DIR` or calls `Command::new("node")`.

### 6. Tests Required

- Unit-test every supported Rust triple to pkg target/suffix mapping and rejection of unsupported targets.
- Simulate missing generated `dist` and `binaries` directories, then assert the standard root build recreates them.
- Run empty-PATH smoke and require `ready`, `pong`, and a real FTS5 WASM query.
- Run `tauri build --no-bundle` and assert the copied release sidecar matches the generated executable.
- Scan tracked/generated release inputs for compile-machine source paths, legacy system-Node launch code, and accidentally tracked large binaries.

### 7. Wrong vs Correct

#### Wrong

```rust
Command::new("node").arg(source_tree.join("sidecar/dist/index.js"));
```

#### Correct

```rust
let (events, child) = app
    .shell()
    .sidecar("litera-sidecar")?
    .set_raw_out(true)
    .spawn()?;
```
