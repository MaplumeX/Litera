# Backend Development Guidelines

> Coding conventions for the Litera Tauri v2 Rust backend.

Litera has no server database or external Agent process. Rust owns validated
file persistence, configuration credentials, Pi v3 session JSONL, native HTTP
permissions, and Tauri commands. The WebView owns the Pi Agent loop and EPUB
content worker.

| Guide | Description |
| --- | --- |
| [Directory Structure](./directory-structure.md) | Rust module and capability layout |
| [Database Guidelines](./database-guidelines.md) | Library, preferences, and Pi session persistence |
| [Error Handling](./error-handling.md) | Structured errors across Rust and the WebView |
| [Tauri Commands](./tauri-commands.md) | Typed WebView ↔ Rust contracts |
| [Quality Guidelines](./quality-guidelines.md) | Session, transport, and Agent quality gates |
| [Logging Guidelines](./logging-guidelines.md) | Credential-safe diagnostics |
| [Desktop Release](./release.md) | Version lockstep and native releases |

**Language**: All documentation is written in **English**.
