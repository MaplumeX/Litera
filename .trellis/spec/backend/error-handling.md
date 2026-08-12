# Error Handling

> How errors are handled across the Litera stack: Rust backend, Node.js sidecar, and React frontend.

---

## Overview

Litera uses simple, string-based error handling throughout. There is no custom error type hierarchy. The key patterns are:

- **Rust commands**: return `Result<T, String>` — errors are human-readable strings surfaced to the WebView.
- **Sidecar**: sends `{ type: "error", message }` protocol messages (never writes to stdout directly).
- **Frontend**: `try/catch` around `invoke()`, with `console.error` + user-facing `alert()`.

Reference files:
- `src-tauri/src/lib.rs` — all `#[tauri::command]` functions return `Result<_, String>`
- `sidecar/index.ts` — `sendError()`, `errorResult()`, catch blocks
- `src/components/LibraryView.tsx`, `src/App.tsx` — frontend catch blocks

---

## Error Types

There are no custom error classes. All errors are `String`:

- **Rust**: `Result<T, String>` where the `Err` variant is a formatted string like `"Book not found: <id>"`.
- **Sidecar**: `{ type: "error", message: string }` protocol messages.
- **Frontend**: `catch (err)` — `err` is `unknown` in TypeScript, typically stringified with `String(err)` or template literals.

```rust
// src-tauri/src/lib.rs
fn read_library(app: &tauri::AppHandle) -> Result<LibraryData, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read library.json: {e}"))?;
    serde_json::from_str::<LibraryData>(&content)
        .map_err(|e| format!("Failed to parse library.json: {e}"))
}
```

---

## Error Handling Patterns

### Rust: `map_err` to format human-readable strings

Every fallible operation uses `.map_err(|e| format!("Context: {e}"))` to wrap the underlying error with context:

```rust
std::fs::read(&path).map_err(|e| format!("Failed to read epub: {e}"))
std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))
```

### Rust: `ok_or` / `ok_or_else` for missing values

```rust
let record = lib.books.iter().find(|b| b.id == book_id)
    .ok_or_else(|| format!("Book not found: {book_id}"))?;
```

### Rust: `unwrap_or` for non-fatal fallbacks

Missing `library.json` or a missing book entry in a read-before-write context uses `unwrap_or` instead of erroring:

```rust
let mut lib = read_library(&app).unwrap_or(LibraryData { books: vec![] });
```

### Sidecar: `sendError()` for protocol errors

The sidecar never panics or crashes on errors. It catches everything and sends an error message:

```typescript
// sidecar/index.ts
function sendError(message: string): void {
  sendMessage({ type: "error", message });
}

// In command handlers:
try {
  // ...
} catch (err) {
  sendError(err instanceof Error ? err.message : String(err));
}
```

### Sidecar: `errorResult()` for tool execution failures

Custom tools return error results instead of throwing:

```typescript
// sidecar/index.ts
function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { error: true },
  };
}

// Usage in tool execute:
if (!isBookLoaded()) return errorResult("No book loaded. Open a book first.");
try {
  const text = readChapter(index);
  return okResult(text);
} catch (err) {
  return errorResult(err instanceof Error ? err.message : String(err));
}
```

### Frontend: try/catch + user-facing alert

```typescript
// src/App.tsx
try {
  const result = await invoke<OpenBookResult>("open_book", { bookId });
  // ...
} catch (err) {
  console.error("open_book error:", err);
  alert(`打开书籍失败: ${err}`);
}
```

### Frontend: silent catch for non-critical persistence

Debounced persistence calls use `.catch(() => {})` — failures are non-fatal:

```typescript
// src/App.tsx
void invoke("update_reading_state", { bookId, lastFraction: fraction }).catch(() => {});
```

### Frontend: user-cancel-aware error suppression

File picker cancellation returns `"No file selected"`. The frontend detects and ignores it:

```typescript
// src/components/LibraryView.tsx
} catch (err) {
  if (String(err).includes("No file selected")) {
    // User cancelled — no error.
  } else {
    console.error("import error:", err);
    alert(`导入失败: ${err}`);
  }
}
```

---

## API Error Responses

Tauri command errors return `Err(String)` which the frontend receives as a rejected promise. There is no structured error code system — the string is the error. The frontend typically:

1. Logs with `console.error`.
2. Shows a user-facing message via `alert()` (Chinese UI labels like `打开书籍失败`).
3. For non-critical operations, silently catches.

---

## Common Mistakes

### Tauri 命令主线程死锁：同步命令中调用阻塞式对话框

**症状**：前端调用 `invoke("open_file")` 后应用完全冻结，系统文件对话框不出现，只能强制退出。

**根因**：Tauri v2 中，非 `async` 的 `#[tauri::command]` 在主线程同步执行。`tauri_plugin_dialog` 的 `blocking_pick_file()` 需要把对话框显示工作派发到主线程并阻塞等待结果；此时主线程已被该命令占用，形成死锁——对话框永远等不到主线程来显示，命令也永远等不到对话框返回。

**修复**：把命令改为 `async fn`，让它运行在 Tauri 异步 runtime 上（不占用主线程），阻塞式 API（`blocking_pick_file()`、`std::fs::read`）用 `tauri::async_runtime::spawn_blocking` 包裹在专用线程池执行。`AppHandle` 需要 `clone()` 后 `move` 进闭包，外层 `app` 仍可用于后续 state 访问。

**规则**：Tauri v2 命令凡需调用 `blocking_*` 对话框 API 或同步阻塞 I/O，必须定义为 `async fn` 并用 `spawn_blocking` 承载阻塞部分。参考 `src-tauri/src/lib.rs` 中 `open_file` 与 `import_book`。

### Swallowing errors that should surface

**Wrong**: `.catch(() => {})` on critical operations like `open_book`.

**Correct**: `.catch(() => {})` only for debounced persistence (`update_reading_state`). Critical operations (`open_book`, `import_book`) must `try/catch` and `alert()` the user.

### Throwing from sidecar tool execute

**Wrong**: `throw new Error("No book loaded")` inside a tool's `execute`.

**Correct**: return `errorResult("No book loaded. Open a book first.")`. The agent SDK handles tool results, not thrown exceptions.

### Using `any` in catch blocks

**Wrong**: `catch (err: any)`.

**Correct**: `catch (err)` (err is `unknown`), then `err instanceof Error ? err.message : String(err)`.