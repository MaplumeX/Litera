# Error Handling

Rust storage commands return `AppResult<T>` with serializable `{ code, message }`
errors. Frontend catches remain `unknown` and use `invokeErrorMessage`.

- Missing, malformed, unsafe, or unsupported persisted data is never converted
  into an empty state that could overwrite recoverable data.
- Blocking dialogs and filesystem operations run from async commands via
  `spawn_blocking` so the Tauri main thread cannot deadlock.
- Runtime and book-worker failures become recoverable local Agent errors and do
  not unmount or disable the reader.
- Tool failures return structured tool results where possible. Prompt/network
  failures emit an Agent error and restore the prompt UI to a retryable state.
- Errors must not include credentials, headers, raw provider bodies, or selected
  book text.

### Convention: Agent tools must wrap Tauri `invoke` errors

**What**: If a tool `execute` calls `invoke`, catch `unknown` and rethrow
`new Error(invokeErrorMessage(error))` before the error leaves the tool.

**Why**: Rust commands serialize as `{ code, message }`, not `Error`.
`pi-agent-core` does `error instanceof Error ? error.message : String(error)`,
so a raw invoke failure becomes the tool result `[object Object]`.

```ts
// Wrong — model sees "[object Object]"
const data = await invoke<AnnotationsFile>("get_annotations", { bookId });

// Correct — structured isError tool result with the AppError message
try {
  const data = await this.bookCall(bookId, () => this.loadAnnotations(bookId));
  return result(JSON.stringify(mapAnnotations(data)));
} catch (error) {
  throw new Error(invokeErrorMessage(error));
}
```

**Tests**: a fake `loadAnnotations` that rejects `{ code, message }` must persist
a `toolResult` with `isError: true` whose text is `message`, not `[object Object]`.
