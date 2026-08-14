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
