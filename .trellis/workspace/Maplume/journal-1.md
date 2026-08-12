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


## Session 9: Library & Reader UX Overhaul: parent integration verification

**Date**: 2026-08-12
**Task**: Library & Reader UX Overhaul: parent integration verification
**Branch**: `main`

### Summary

Parent task 08-12-library-reader-ux integration verification. Both child tasks completed and archived: library-management (book library + persistence) and reader-enhancement (TOC sidebar + font/theme + position restore). Verified npm run build + cargo build pass. End-to-end flow confirmed by code review: startup→library→import→read(TOC/font/theme)→back-to-library→reopen(restore). ChatPanel unchanged.

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**


## Session 10: Bootstrap spec: fill all backend + frontend guidelines

**Date**: 2026-08-12
**Task**: Bootstrap spec: fill all backend + frontend guidelines
**Branch**: `main`

### Summary

Filled the 5 remaining template spec files with real codebase patterns: database-guidelines (library.json file storage + in-memory FTS5 + JSONL sessions), logging-guidelines (eprintln + sidecar error protocol), hook-guidelines (useDebouncedCallback, ref-stable callbacks, useImperativeHandle, Tauri listen), state-management (local useState + props + Tauri events, no global store), type-safety (Rust serde camelCase contract, foliate.js typing, no any). Rewrote error-handling.md to cover full-stack patterns instead of template stubs. Updated backend + frontend index.md files with accurate descriptions. Archived 00-bootstrap-guidelines task.

### Git Commits

| Hash | Message |
|------|---------|
| `b9df4b0` | (see git log) |

### Status

[OK] **Completed**


## Session 11: 修复 Tauri 运行时完整性

**Date**: 2026-08-12
**Task**: 修复 Tauri 运行时完整性
**Branch**: `main`

### Summary

完成书库可恢复事务与路径安全、Raw IPC 和自包含 sidecar、有关联的有界 supervisor/Agent 状态机、React 生命周期与快速开书串行化；全量 Rust/前端/sidecar/Clippy/空 PATH smoke/Tauri release 门禁通过。

### Git Commits

| Hash | Message |
|------|---------|
| `321f21b` | (see git log) |
| `a14cf08` | (see git log) |
| `3c7b449` | (see git log) |
| `950fb46` | (see git log) |

### Status

[OK] **Completed**


## Session 12: Decouple sidecar from host pi: child 1 (agent dir protocol)

**Date**: 2026-08-12
**Task**: Decouple sidecar from host pi: child 1 (agent dir protocol)
**Branch**: `main`

### Summary

Added the configure command to the sidecar protocol so Rust injects a Litera-owned <app_data_dir>/agent/ directory after every ready event. Sidecar no longer reads ~/.pi/agent; createAgentSession now passes agentDir explicitly to prevent the pi SDK modelRuntime fallback. Protocol fixture, sidecar tests (15), and Rust tests (36) all pass. Child 2 (config UI) remains in planning.

### Git Commits

| Hash | Message |
|------|---------|
| `add98b1` | (see git log) |

### Status

[OK] **Completed**


## Session 13: Decouple sidecar from host pi: child 2 (config UI) + parent complete

**Date**: 2026-08-12
**Task**: Decouple sidecar from host pi: child 2 (config UI) + parent complete
**Branch**: `main`

### Summary

Added LLM provider config UI (AgentConfigDialog) and Rust agent_config module (get_agent_config / save_agent_config) that merge-write auth.json + settings.json in the Litera-owned agent dir. Frontend hardcodes 10 common api_key providers; model is free-text. After saving, restart_sidecar is called so config takes effect. ChatPanel shows an unconfigured notice when no provider is set. Both children of the decouple-agent-config parent are now done; parent archived. Rust 44 tests pass, tsc + vite build pass.

### Git Commits

| Hash | Message |
|------|---------|
| `158a274` | (see git log) |

### Status

[OK] **Completed**


## Session 14: 现代化阅读器 UI 重构:lucide 图标化 + 进度条集成

**Date**: 2026-08-12
**Task**: 现代化阅读器 UI 重构:lucide 图标化 + 进度条集成
**Branch**: `main`

### Summary

将阅读器界面从文字按钮平铺重构为现代阅读软件形态:顶栏按钮全部 lucide 图标化并按左右分组,删除底栏翻页按钮改用键盘/点击区域翻页,进度条集成进顶栏右侧,聊天面板头部按钮图标化移除 emoji,书库导入按钮加 Plus 图标。引入 9 个 lucide-react 图标。研究并参照 Apple Books/Readwise Reader/微信读书的 UI 模式。npm run build 通过,全量 check 通过。

### Git Commits

| Hash | Message |
|------|---------|
| `6297588` | (see git log) |

### Status

[OK] **Completed**


## Session 15: 支持自定义 OpenAI 兼容供应商

**Date**: 2026-08-12
**Task**: 支持自定义 OpenAI 兼容供应商
**Branch**: `main`

### Summary

实现多个自定义 OpenAI 兼容端点配置（Ollama/vLLM/第三方中转）。Rust 新增 models.json 原子读写 + add/delete/switch_provider 命令（custom- 前缀 guard，apiKey 走 auth.json）；前端 AgentConfigDialog 重构为内置/自定义两段式下拉 + 添加子表单 + 只读信息+删除+切换。sidecar 零改动（pi 自动读 models.json）。全量验证通过：cargo test 54 passed、tsc、vite build 全绿。

### Git Commits

| Hash | Message |
|------|---------|
| `bdff16d` | (see git log) |

### Status

[OK] **Completed**
