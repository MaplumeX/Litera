# Journal - Maplume (Part 1)

> AI development session journal
> Started: 2026-08-11

---



## Session 1: Plan agent-epub-reader + scaffold Tauri/React

**Date**: 2026-08-11
**Task**: Plan agent-epub-reader + scaffold Tauri/React
**Branch**: `main`

### Summary

Planned the Agent-Enhanced EPUB Reader (parent task agent-epub-reader) with full prd/design/implement artifacts and 5 child tasks. Tech stack: Tauri 2 + React + Vite + Tailwind + shadcn/ui + foliate.js + pi agent sidecar + SQLite FTS5 WASM (trigram). Implemented and verified Child 1 (Tauri + React scaffolding): project init, Tailwind v4, shadcn/ui, react-resizable-panels, react-markdown, tauri-plugin-dialog, CSP config, sidecar/ placeholder. All checks pass (tsc, vite build, cargo check). Updated frontend spec with directory structure, component guidelines, and CSP conventions.

### Git Commits

| Hash | Message |
|------|---------|
| `cf5c690` | (see git log) |

### Status

[OK] **Completed**


## Session 2: Child 2: EPUB rendering (foliate.js)

**Date**: 2026-08-11
**Task**: Child 2: EPUB rendering (foliate.js)
**Branch**: `main`

### Summary

Integrated foliate.js via git submodule. Rust open_file command with tauri-plugin-dialog. ReaderView React component mounting <foliate-view> web component. Prev/next navigation, chapter progress display, selection capture with floating 'ask agent' button. fixFoliateGlob Vite plugin for pdf.js glob pattern. All checks pass.

### Git Commits

| Hash | Message |
|------|---------|
| `88fc63b` | (see git log) |

### Status

[OK] **Completed**


## Session 3: Child 3: pi agent sidecar

**Date**: 2026-08-12
**Task**: Child 3: pi agent sidecar
**Branch**: `main`

### Summary

Implemented pi agent sidecar: Node.js child process with stdio JSON lines protocol. sidecar/index.ts uses createAgentSession + SessionManager.inMemory + session.subscribe. Rust spawns node sidecar/dist/index.js, reads stdout in thread, emits agent_* Tauri events, kills on window destroy. ChatPanel temporary UI for verification. All checks pass (sidecar tsc, npm build, cargo check).

### Git Commits

| Hash | Message |
|------|---------|
| `604e69d` | (see git log) |

### Status

[OK] **Completed**


## Session 4: Child 4: reading assistant integration

**Date**: 2026-08-12
**Task**: Child 4: reading assistant integration
**Branch**: `main`

### Summary

Integrated all layers: sidecar EPUB parsing (adm-zip) + FTS5 index (fts5-sql-bundle WASM trigram) + 4 custom tools (get_book_metadata/get_toc/read_chapter/search_in_book) + system prompt + prompt context injection. Rust open_file sends book_opened, agent_prompt accepts selection+chapterIndex. Frontend react-resizable-panels split layout, formal ChatPanel with Markdown rendering, selection quote blocks, collapsible tool cards, streaming output. Selection trigger wired ReaderView->ChatPanel fillInput. Fixed FTS5 snippet alias bug. All checks pass.

### Git Commits

| Hash | Message |
|------|---------|
| `9acdd13` | (see git log) |
| `b32e54e` | (see git log) |

### Status

[OK] **Completed**


## Session 5: Child 5: multi-session management + list UI

**Date**: 2026-08-12
**Task**: Child 5: multi-session management + list UI
**Branch**: `main`

### Summary

Upgraded sidecar from single inMemory session to Map<sessionId, ManagedSession> with SessionManager.create persistent jsonl. Implemented new/switch/delete/list session handlers with disk recovery fallback. Rust IPC commands + 4 new event types. open_file passes sessionsDir + auto list_sessions. ChatPanel session list UI (overlay panel, new/switch/delete), auto-switch to most recent, history render on switch. All checks pass.

### Git Commits

| Hash | Message |
|------|---------|
| `25b4350` | (see git log) |

### Status

[OK] **Completed**


## Session 6: 修复 open_file 主线程死锁

**Date**: 2026-08-12
**Task**: 修复 open_file 主线程死锁
**Branch**: `main`

### Summary

点击'打开文件'卡死的根因是 open_file 同步命令在主线程跑 blocking_pick_file() 导致死锁。改为 async fn 并用 spawn_blocking 包裹阻塞 API，前端接口不变。修复记录到 backend/error-handling.md。

### Git Commits

| Hash | Message |
|------|---------|
| `32781c7` | (see git log) |

### Status

[OK] **Completed**


## Session 7: Library Management: book library with import/delete/search/persistence

**Date**: 2026-08-12
**Task**: Library Management: book library with import/delete/search/persistence
**Branch**: `main`

### Summary

Implemented the library-management child task: Rust book persistence commands (import_book, save_book_metadata, list_books, open_book, delete_book, update_reading_state) with library.json + books/<id>/ storage, LibraryView + BookCard components with cover grid and search, App.tsx view routing (library|reader), foliate.js offscreen metadata extraction, Tauri asset protocol for cover display. Fixed position-restore ordering (await init before goToFraction) and language-map metadata extraction. Updated specs (Tauri commands contract, foliate.js patterns). Planned parent + reader-enhancement child task.

### Git Commits

| Hash | Message |
|------|---------|
| `64e363e` | (see git log) |
| `6c44ac1` | (see git log) |
| `120396f` | (see git log) |

### Status

[OK] **Completed**


## Session 8: Reader Enhancement: TOC sidebar, font/theme controls, position restore

**Date**: 2026-08-12
**Task**: Reader Enhancement: TOC sidebar, font/theme controls, position restore
**Branch**: `main`

### Summary

Implemented the reader-enhancement child task: TocSidebar (nested chapter tree from book.toc, click goToTocItem), ReaderControls (font size S/M/L/XL + font family serif/sans-serif/monospace + theme light/dark/sepia dropdown panel), ReaderView extended with goToFraction/goToTocItem/setStyles/getToc + onBookReady callback, App.tsx integration with TOC toggle, settings persistence (debounced update_reading_state), position restore. Fixed mono font family value bug. Updated specs (setStyles pattern, ref-stable callback pattern).

### Git Commits

| Hash | Message |
|------|---------|
| `307f23f` | (see git log) |
| `2c6bef1` | (see git log) |

### Status

[OK] **Completed**
