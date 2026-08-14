# Logging Guidelines

Litera uses minimal diagnostics: Rust uses `eprintln!` for actionable storage or
initialization failures; React uses `console.error` for failed user operations.

- Never log API keys, authorization headers, provider request bodies, session
  message bodies, selected book text, or full user-controlled URLs.
- Native model transport errors are replaced by a credential-free message.
- Expected validation failures should be returned as structured `AppError`
  values rather than logged twice.
- Do not add a logging framework unless the project needs structured telemetry
  and its privacy contract has been reviewed.
