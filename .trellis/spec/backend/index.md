# Backend Development Guidelines

> Coding conventions for the Litera Rust backend + Node.js sidecar.

---

## Overview

Litera's backend is a Tauri v2 Rust application (`src-tauri/`) with a Node.js sidecar (`sidecar/`). There is no traditional database server — persistence is file-based (`library.json`, JSONL sessions) plus an in-memory SQLite FTS5 index in the sidecar.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Module organization: `src-tauri/`, `sidecar/`, capabilities |
| [Database Guidelines](./database-guidelines.md) | library.json file storage, in-memory FTS5, JSONL sessions |
| [Error Handling](./error-handling.md) | Structured `AppError`, frontend visibility, Tauri deadlock avoidance |
| [Tauri Commands](./tauri-commands.md) | IPC command contracts (WebView ↔ Rust ↔ sidecar) |
| [Quality Guidelines](./quality-guidelines.md) | Sidecar stdio JSON lines protocol, process management |
| [Logging Guidelines](./logging-guidelines.md) | `eprintln!` stderr, sidecar error protocol messages |
| [Desktop Release](./release.md) | Version lockstep, tag-triggered GitHub Release, host-native sidecar, ad-hoc macOS signing |

---

**Language**: All documentation is written in **English**.
