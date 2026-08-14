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


## Session 16: Fix prompt context injection polluting user messages

**Date**: 2026-08-12
**Task**: Fix prompt context injection polluting user messages
**Branch**: `main`

### Summary

Replaced buildPromptWithContext (which concatenated context into user text, polluting session history) with sendCustomMessage nextTurn aside injection. User messages now store only raw input; chapter index/selection context is delivered to the model as an aside. Deleted buildPromptWithContext and orphaned PromptContext import. Added spec convention to quality-guidelines.md.

### Git Commits

| Hash | Message |
|------|---------|
| `04bcc0e` | (see git log) |

### Status

[OK] **Completed**


## Session 17: Fix new session not appearing in list

**Date**: 2026-08-12
**Task**: Fix new session not appearing in list
**Branch**: `main`

### Summary

Fixed new session not appearing in the session list after clicking 'New Session'. The root cause was that session_created triggered a listSessions() call that returned a disk list missing the not-yet-persisted session, which then overwrote the optimistic entry. Fix: (1) added upsertSession helper to agent-reducer that optimistically inserts the new session on session_created, (2) removed the listSessions() call on session_created in use-agent-bridge so the optimistic entry survives until the next real list refresh (prompt_end). Added tests for optimistic insert, dedupe, and book mismatch.

### Git Commits

| Hash | Message |
|------|---------|
| `02d36ec` | (see git log) |

### Status

[OK] **Completed**


## Session 18: Fix new session not appearing in list

**Date**: 2026-08-12
**Task**: Fix new session not appearing in list
**Branch**: `main`

### Summary

Root cause: sidecar's SessionManager doesn't persist empty sessions to disk (no assistant msg yet), so listSessions() right after session_created excluded the new session. Fix: optimistic insert in agent-reducer session_created case via upsertSession helper; removed the listSessions() call on session_created in use-agent-bridge; added 2 reducer tests. Updated frontend state-management spec with the optimistic session creation pattern.

### Git Commits

| Hash | Message |
|------|---------|
| `02d36ec` | (see git log) |
| `d14b643` | (see git log) |

### Status

[OK] **Completed**


## Session 19: Improve provider switching and editing

**Date**: 2026-08-12
**Task**: Improve provider switching and editing
**Branch**: `main`

### Summary

Provider config UX: (1) selecting a custom provider in the dropdown now switches immediately (removed '使用此供应商' button); (2) custom providers are editable (name/baseUrl/apiKey/model) via new update_custom_provider Tauri command — empty key keeps existing; (3) built-in providers with a saved key can save model-only changes without re-entering the key (save_config keeps existing key when api_key empty, errors only when no key exists). 8 new Rust tests; cargo test 62 passed, vitest 20 passed, build green.

### Git Commits

| Hash | Message |
|------|---------|
| `759bcb1` | (see git log) |
| `6af192f` | (see git log) |
| `c81b780` | (see git log) |

### Status

[OK] **Completed**


## Session 20: Migrate AgentConfigDialog to shadcn/ui

**Date**: 2026-08-12
**Task**: Migrate AgentConfigDialog to shadcn/ui
**Branch**: `main`

### Summary

Added shadcn dialog/select/input/label components via npx shadcn@latest add. Migrated AgentConfigDialog from native <select>/<input>/<label>/hand-written overlay to shadcn Dialog/Select/Input/Label. Select grouping uses SelectGroup/SelectLabel/SelectSeparator; __add_custom__ sentinel value handled in onValueChange. All interaction logic preserved (select-switch, edit form, empty-key save, auto-close). Updated component-guidelines spec with installed-components registry and select grouping rule. Build + vitest green.

### Git Commits

| Hash | Message |
|------|---------|
| `339e1c2` | (see git log) |
| `c827c5d` | (see git log) |
| `e955fd5` | (see git log) |

### Status

[OK] **Completed**


## Session 21: 子任务A：聊天面板消息交互增强

**Date**: 2026-08-12
**Task**: 子任务A：聊天面板消息交互增强
**Branch**: `main`

### Summary

实现中止后重试（恢复输入框+ring高亮）、AI回复复制（CopyButton）、用户消息编辑（Pencil按钮填入输入框重发）。仅改 ChatPanel.tsx，测试与构建通过。

### Git Commits

| Hash | Message |
|------|---------|
| `9fde500` | (see git log) |

### Status

[OK] **Completed**


## Session 22: 子任务B：会话重命名

**Date**: 2026-08-12
**Task**: 子任务B：会话重命名
**Branch**: `main`

### Summary

跨四层实现会话重命名：sidecar协议扩展(rename_session/session_renamed)、Rust镜像+Tauri command、前端reducer+ChatPanel行内编辑UI。新增reducer测试，全部测试通过。

### Git Commits

| Hash | Message |
|------|---------|
| `fa13140` | (see git log) |

### Status

[OK] **Completed**


## Session 23: 子任务C：主题与设置入口统一化

**Date**: 2026-08-12
**Task**: 子任务C：主题与设置入口统一化
**Branch**: `main`

### Summary

主题从按书保存改为全局偏好(preferences.json)，应用到<html>使Portal Dialog也能继承CSS变量。新增sepia外壳配色、SettingsDialog统一入口(阅读偏好+AI配置)，书库页/阅读器页/ChatPanel三处入口统一。删除ReaderControls.tsx。新增Rust preferences.rs(8测试)。

### Git Commits

| Hash | Message |
|------|---------|
| `13fb954` | (see git log) |

### Status

[OK] **Completed**


## Session 24: Fix Command does not match the current book race

**Date**: 2026-08-12
**Task**: Fix Command does not match the current book race
**Branch**: `main`

### Summary

Fixed intermittent 'Command does not match the current book' in the AI chat panel. Root cause: useAgentBridge's book_changed effect fired list_sessions/get_agent_snapshot as soon as bookId changed, but open_book_bytes only confirms the OpenBook command entered the sidecar writer queue — the sidecar SerialDispatcher may still have currentBook=null or the previous book, so requireCurrentBook rejected the early command. Fix: drive session-list refresh, pending-session restore, and the first prompt from the book_ready event instead; add pendingRestoreSessionIdRef for restart/replay hydration; gate prompt() with a statusRef backstop. Added 5 use-agent-bridge behavior tests (T1-T5); all 27 tests green. Updated hook-guidelines spec with the book_changed command-gating convention and a Common Mistake entry.

### Git Commits

| Hash | Message |
|------|---------|
| `6f9a26c` | (see git log) |
| `397dbc3` | (see git log) |

### Status

[OK] **Completed**


## Session 25: Redesign ChatPanel UI (ChatGPT style)

**Date**: 2026-08-13
**Task**: Redesign ChatPanel UI (ChatGPT style)
**Branch**: `main`

### Summary

Planned (PRD/design/implement), implemented, and checked the reading-assistant chat panel UI redesign: ChatGPT-style right-aligned user bubbles with quote cards, left-aligned assistant messages with Bot avatar, rounded auto-grow input with inline send/stop, welcome empty state with contextual suggestions, typing indicator + streaming cursor, lucide icon cleanup (no emoji), ResizeObserver fix for panel-resize height. 7 work commits + spec updates. Build and all 27 tests green. Manual three-theme visual inspection left for the user.

### Git Commits

| Hash | Message |
|------|---------|
| `20570ea` | (see git log) |
| `ed0d259` | (see git log) |
| `0f8f787` | (see git log) |
| `0166061` | (see git log) |
| `dab2515` | (see git log) |
| `1a2e6b0` | (see git log) |
| `ceae8b1` | (see git log) |
| `67fb429` | (see git log) |

### Status

[OK] **Completed**


## Session 26: Separate chat and library settings

**Date**: 2026-08-13
**Task**: Separate chat and library settings
**Branch**: `main`

### Summary

Chat panel gear now opens only AgentConfigDialog (LLM settings). Library gear and reader Aa still open SettingsDialog. Removed ChatPanel onOpenSettings and the void ?? fallback that opened both dialogs. Spec records settings entry ownership.

### Git Commits

| Hash | Message |
|------|---------|
| `9d77cb1` | (see git log) |
| `abe063b` | (see git log) |
| `5453976` | (see git log) |

### Status

[OK] **Completed**


## Session 27: Inject book snapshot aside

**Date**: 2026-08-13
**Task**: Inject book snapshot aside
**Branch**: `main`

### Summary

New sessions receive a hidden first-turn bookSnapshot aside (metadata + truncated TOC) so the agent no longer needs get_book_metadata/get_toc before answering. Tools remain as fallbacks; spec records the nextTurn convention.

### Git Commits

| Hash | Message |
|------|---------|
| `b89dbbd` | (see git log) |
| `3176a32` | (see git log) |

### Status

[OK] **Completed**


## Session 28: Inline-edit chat user messages

**Date**: 2026-08-13
**Task**: Inline-edit chat user messages
**Branch**: `main`

### Summary

Planned and implemented ChatGPT-style inline edit: edit_prompt/session_rewound across sidecar, Rust, and frontend; navigateTree rewind without a branch switcher; moved edit/copy buttons to reserved rows below bubbles. Specs updated. Tests and build green; live UI not clicked.

### Git Commits

| Hash | Message |
|------|---------|
| `36b8bc7` | (see git log) |
| `8efae8a` | (see git log) |
| `bd65c3b` | (see git log) |

### Status

[OK] **Completed**


## Session 29: Library shelf loop and import-delete UX

**Date**: 2026-08-13
**Task**: Library shelf loop and import-delete UX
**Branch**: `main`

### Summary

Planned and implemented library shelf UX: reader title, card progress, lastOpenedAt sort, multi-file/drag-drop import, path+content-hash dedup with overwrite confirm, AlertDialog delete with session cleanup, and toolbar selection mode. Specs updated. cargo test 82 / npm test 43 / build green.

### Git Commits

| Hash | Message |
|------|---------|
| `2890f8c` | (see git log) |
| `bbbf5be` | (see git log) |
| `99b31ad` | (see git log) |

### Status

[OK] **Completed**


## Session 30: Align book tools with ReadAware

**Date**: 2026-08-13
**Task**: Align book tools with ReadAware
**Branch**: `main`

### Summary

Aligned get_toc, read_chapter, and search_in_book with ReadAware contracts: chapterNumber, 12k read windows, multi-query FTS merge. No spoiler fence. Recorded sidecar tool contracts in backend specs.

### Git Commits

| Hash | Message |
|------|---------|
| `62def2e` | (see git log) |
| `4510111` | (see git log) |
| `5268846` | (see git log) |

### Status

[OK] **Completed**


## Session 31: Restore desktop reader page turning
## Session 31: Associate Litera as an EPUB opener

**Date**: 2026-08-13
**Task**: Associate Litera as an EPUB opener
**Branch**: `litera-epub-association-design`

### Summary

Registered .epub file association and wired OS open to import-then-open the last successful book on macOS, Windows, and Linux.

### Main Changes

- Added bundle.fileAssociations, a drained OS-open path queue, and single-instance forwarding
- App imports system-opened EPUBs and opens the last success; picker/drag-drop still import only
- Recorded OS EPUB open contracts in backend/frontend specs

### Git Commits

| Hash | Message |
|------|---------|
| `c19294a` | (see git log) |
| `03967af` | (see git log) |
| `8032585` | (see git log) |

### Testing

- [OK] npx vitest run: 58 passed
- [OK] cargo test in src-tauri: 92 passed
- [OK] npx tsc --noEmit: passed
- [OK] Not verified: packaged macOS open -a / Windows Explorer / Linux file manager association

### Status

[OK] **Completed**

### Next Steps

- Verify packaged Open With on macOS; Windows/Linux association when those machines are available


## Session 32: Restore desktop reader page turning

**Date**: 2026-08-13
**Task**: Restore desktop reader page turning
**Branch**: `fix/fanye-wufafa`

### Summary

Restored desktop page turning after footer buttons were removed: left/right third click, arrow keys (including after focusing the chapter iframe), and trackpad/wheel one page per gesture. ReaderView owns all paging input; App no longer listens on window. Recorded the foliate iframe event model in frontend specs. Tests 56 passed, build green. Live UI not clicked.

### Git Commits

| Hash | Message |
|------|---------|
| `1823894` | (see git log) |
| `f545d8e` | (see git log) |
| `bdf5614` | (see git log) |
| `d3daa9e` | (see git log) |
| `60802d5` | (see git log) |
| `730eb3c` | (see git log) |

### Status

[OK] **Completed**


## Session 32: Settings page and typography defaults

**Date**: 2026-08-13
**Task**: Settings page and typography defaults
**Branch**: `feat/settings-ui-layout-and-configurable-items`

### Summary

Replaced the settings dialog with a dedicated page (typography / appearance / AI). Added line height, page margin, and text-align with global defaults plus per-book overrides. Chat gear still opens the LLM dialog. Specs and planning artifacts recorded. Tests and build were green; live Tauri UI was not clicked.
## Session 33: Optimize reading UI layout

**Date**: 2026-08-13
**Task**: Optimize reading UI layout
**Branch**: `feat/reading-ui-layout-optimization`

### Summary

Planned and implemented reading-first layout: book title as header, full-width progress, overlay TOC drawer, chat default collapsed with process-only memory, 问 agent auto-opens then fillInput. Specs record chrome conventions. tsc/test/build green.

### Git Commits

| Hash | Message |
|------|---------|
| `61a6851` | (see git log) |
| `0d0f855` | (see git log) |
| `38cb99a` | (see git log) |
| `c3f4832` | (see git log) |
| `e37c573` | (see git log) |
| `0e5a6b1` | (see git log) |

### Status

[OK] **Completed**


## Session 35: Remove reader progress bar

**Date**: 2026-08-13
**Task**: Remove reader progress bar
**Branch**: `feat/progress-bar-presentation`

### Summary

Deleted the dedicated reader progress row so the book sits under the toolbar. Relocate state still feeds chat chapter index and library card progress. Updated frontend specs to match.

### Git Commits

| Hash | Message |
|------|---------|
| `9840d53` | (see git log) |

### Status

[OK] **Completed**


## Session 36: Tune wheel paging to Readest sensitivity

**Date**: 2026-08-13
**Task**: Tune wheel paging to Readest sensitivity
**Branch**: `main`

### Summary

Replaced extending-cooldown wheel paging with Readest idle-reset: 30px threshold, 200ms silence starts a new gesture, deltaMode line/page normalized. Spec and task artifacts recorded.

### Git Commits

| Hash | Message |
|------|---------|
| `348f64d` | (see git log) |
| `f8bc73f` | (see git log) |
| `ecf98fb` | (see git log) |

### Status

[OK] **Completed**


## Session 37: Fine-tune reader typography settings

**Date**: 2026-08-13
**Task**: Fine-tune reader typography settings
**Branch**: `main`

### Summary

Converted reader typography from preset gears to numeric sliders (font size, line height, content width, page padding, letter spacing, paragraph spacing, first-line indent). Font size and family now use global default plus per-book override. Old lineHeight/pageMargin enums dual-read; specs updated.

### Git Commits

| Hash | Message |
|------|---------|
| `7d18f36` | (see git log) |
| `2ea3364` | (see git log) |

### Status

[OK] **Completed**


## Session 38: Improve new session UX

**Date**: 2026-08-13
**Task**: Improve new session UX
**Branch**: `main`

### Summary

Polished the chat-list 新建会话 path: close overlay and focus input, reuse an already-empty session, default title 新会话, and ready-state empty copy. Spec updated to keep reducer and sidecar titles in sync.

### Git Commits

| Hash | Message |
|------|---------|
| `d664cec` | (see git log) |
| `3619bae` | (see git log) |

### Status

[OK] **Completed**


## Session 39: Add zh-CN/en UI i18n

**Date**: 2026-08-13
**Task**: Add zh-CN/en UI i18n
**Branch**: `main`

### Summary

Shipped React UI i18n for zh-CN and English: in-house t()/useT catalogs, localStorage persistence, OS-locale default, Settings appearance switcher. Did not touch preferences.json. Recorded frontend i18n spec.

### Git Commits

| Hash | Message |
|------|---------|
| `fed35d0` | (see git log) |
| `5c0db39` | (see git log) |

### Status

[OK] **Completed**


## Session 40: Settings as centered dialog

**Date**: 2026-08-13
**Task**: Settings as centered dialog
**Branch**: `main`

### Summary

Replaced the full-screen settings root view with a centered SettingsDialog overlay. Library gear and reader Aa open the dialog without unmounting the current page; chat still owns AgentConfigDialog. Specs updated so view stays library|reader and settingsOpen owns general settings.

### Git Commits

| Hash | Message |
|------|---------|
| `c3fd23b` | (see git log) |
| `2441097` | (see git log) |

### Status

[OK] **Completed**


## Session 41: Lock settings dialog to a fixed size

**Date**: 2026-08-14
**Task**: Lock settings dialog to a fixed size
**Branch**: `main`

### Summary

SettingsDialog shell is now a fixed 768x640 box (capped at 85vh / calc(100%-2rem)) so switching typography/appearance/AI no longer resizes the overlay. Spec records the size contract and the shadcn sm:max-w-lg override gotcha.

### Git Commits

| Hash | Message |
|------|---------|
| `6209a62` | (see git log) |
| `5fc7650` | (see git log) |

### Status

[OK] **Completed**


## Session 42: Unify reader and agent chapter coordinates

**Date**: 2026-08-14
**Task**: Unify reader and agent chapter coordinates
**Branch**: `main`

### Summary

TOC-owned chapter list plus chapterHref locator so reader, snapshot, and book tools share one index.

### Main Changes

- Sidecar assigns spine files to flattened TOC hrefs; FTS and tools use the owned list
- Prompts send chapterHref from foliate tocItem.href or section.id; aside names title + chapterNumber
- Recorded the PromptContext and ownership contract in backend/frontend specs

### Git Commits

| Hash | Message |
|------|---------|
| `f1caf6a` | (see git log) |
| `542f16c` | (see git log) |

### Testing

- [OK] sidecar npm test (34); vitest agent-bridge/reducer/ChatPanel; tsc; cargo test sidecar_protocol

### Status

[OK] **Completed**

### Next Steps

- Optional follow-up: inject viewport visible_text (reading_cursor), still out of this task


## Session 43: Let readers pick a system font

**Date**: 2026-08-14
**Task**: Let readers pick a system font
**Branch**: `main`

### Summary

Added a searchable system-font picker for reader body text. fontFamily is now a validated named family (not a 3-value enum) so preferences.json is not wiped on relaunch; missing faces fall back to serif in CSS and stay marked unavailable in settings.

### Git Commits

| Hash | Message |
|------|---------|
| `62edf1c` | (see git log) |
| `9268375` | (see git log) |

### Status

[OK] **Completed**
