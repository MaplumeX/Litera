# Error Handling

> How errors are handled across the Litera stack: Rust backend, Node.js sidecar, and React frontend.

---

## Overview

Litera uses different error contracts at its two backend boundaries:

- **Rust library commands**: return `AppResult<T>` with serializable `{ code, message }` errors.
- **Legacy/non-library Rust commands**: may still return `Result<T, String>` until migrated.
- **Sidecar**: sends `{ type: "error", message }` protocol messages (never writes to stdout directly).
- **Frontend**: decodes structured invoke errors and makes storage failures visible.

Reference files:
- `src-tauri/src/error.rs`, `src-tauri/src/library.rs` — `AppError` and library commands
- `sidecar/index.ts` — `sendError()`, `errorResult()`, catch blocks
- `src/components/LibraryView.tsx`, `src/App.tsx` — frontend catch blocks

---

## Error Types

Library persistence has an explicit error taxonomy:

- `Cancelled`, `InvalidInput`, `BookNotFound`, `StorageCorrupt`, `StorageIo`, `RollbackFailed`.
- **Rust**: `AppResult<T> = Result<T, AppError>`; `AppError` serializes as `{ code, message }`.
- **Sidecar**: `{ type: "error", message: string }` protocol messages.
- **Frontend**: `catch (err)` remains `unknown`; use `isInvokeAppError` / `invokeErrorMessage`.

```rust
return Err(AppError::storage_corrupt(format!(
    "Failed to parse library.json: {error}"
)));
```

---

## Error Handling Patterns

### Rust library: map failures to a stable code with contextual messages

Every fallible operation uses `.map_err(|e| format!("Context: {e}"))` to wrap the underlying error with context:

```rust
fs::read(&path).map_err(|error| AppError::storage_io(format!("Failed to read EPUB: {error}")))
```

### Rust: `ok_or` / `ok_or_else` for missing values

```rust
let record = library.books.iter().find(|book| book.id == book_id)
    .ok_or_else(|| AppError::book_not_found(book_id))?;
```

### Rust library: never turn storage failure into empty state

After initialization, a missing, unreadable, malformed, or schema-mismatched `library.json` is an error. Never use `unwrap_or(empty)` in a read-modify-write path; it can overwrite recoverable data.

```rust
let mut library = self.read_library()?;
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

### Frontend: debounced persistence still surfaces failures

Debounced persistence is asynchronous but not silent. The controller reports timer-triggered failures, while `flush()` rejects so navigation/close logic can respond:

```typescript
// src/App.tsx
const persistFraction = useDebouncedCallback(
  (bookId, fraction) => invoke("update_reading_state", { bookId, lastFraction: fraction }),
  500,
  reportPersistenceError,
);
```

### Frontend: user-cancel-aware error suppression

File picker cancellation returns `{ code: "Cancelled", message: "No file selected" }`. Ignore only the stable code:

```typescript
// src/components/LibraryView.tsx
} catch (err) {
  if (isInvokeAppError(err) && err.code === "Cancelled") {
    // User cancelled — no error.
  } else {
    console.error("import error:", err);
    alert(`导入失败: ${err}`);
  }
}
```

---

## API Error Responses

Library Tauri command errors reject with a structured object. The frontend:

1. Logs with `console.error`.
2. Shows a user-facing message via `alert()` (Chinese UI labels like `打开书籍失败`).
3. Keeps persistence failures visible in an inline alert; `flush()` failure prevents leaving the reader.

---

## Common Mistakes

### Tauri 命令主线程死锁：同步命令中调用阻塞式对话框

**症状**：前端调用 `invoke("open_file")` 后应用完全冻结，系统文件对话框不出现，只能强制退出。

**根因**：Tauri v2 中，非 `async` 的 `#[tauri::command]` 在主线程同步执行。`tauri_plugin_dialog` 的 `blocking_pick_file()` 需要把对话框显示工作派发到主线程并阻塞等待结果；此时主线程已被该命令占用，形成死锁——对话框永远等不到主线程来显示，命令也永远等不到对话框返回。

**修复**：把命令改为 `async fn`，让它运行在 Tauri 异步 runtime 上（不占用主线程），阻塞式 API（`blocking_pick_file()`、`std::fs::read`）用 `tauri::async_runtime::spawn_blocking` 包裹在专用线程池执行。`AppHandle` 需要 `clone()` 后 `move` 进闭包，外层 `app` 仍可用于后续 state 访问。

**规则**：Tauri v2 命令凡需调用 `blocking_*` 对话框 API 或同步阻塞 I/O，必须定义为 `async fn` 并用 `spawn_blocking` 承载阻塞部分。参考 `src-tauri/src/lib.rs` 中 `open_file` 与 `import_book`。

### Swallowing errors that should surface

**Wrong**: `.catch(() => {})` on critical operations like `open_book`.

**Correct**: no library persistence error is swallowed. Timer-triggered debounce errors update visible state; explicit `flush()` calls reject. Critical operations (`open_book`, `import_book`) use `try/catch` and a user-facing message.

### Throwing from sidecar tool execute

**Wrong**: `throw new Error("No book loaded")` inside a tool's `execute`.

**Correct**: return `errorResult("No book loaded. Open a book first.")`. The agent SDK handles tool results, not thrown exceptions.

### Using `any` in catch blocks

**Wrong**: `catch (err: any)`.

**Correct**: `catch (err)` (err is `unknown`), then `err instanceof Error ? err.message : String(err)`.
