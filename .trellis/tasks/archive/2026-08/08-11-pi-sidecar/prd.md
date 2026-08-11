# pi agent sidecar integration

## Goal

实现 pi agent 作为 Tauri sidecar 子进程运行，通过 stdio JSON lines 通信，支持基础对话（无书籍工具）。这是 agent 能力的基础层，Child 4 在此之上加书籍工具。

## Parent Reference

父任务：`08-11-agent-epub-reader`。本子任务对应 `implement.md` Child 3。依赖 Child 1（已完成：脚手架）。

## Requirements

- `sidecar/` 目录：初始化 npm 项目，安装 `@earendil-works/pi-coding-agent`
- 实现 `sidecar/index.ts`：`createAgentSession()` + `SessionManager.inMemory()` + `session.subscribe()` 事件转 stdio JSON lines
- stdio 协议（sidecar stdin → sidecar 处理 → sidecar stdout）：
  - 输入：`{ type: "prompt", text: string }` / `{ type: "abort" }`
  - 输出：`{ type: "text_delta", delta }` / `{ type: "tool_start", tool, params }` / `{ type: "tool_end", result }` / `{ type: "agent_end" }` / `{ type: "error", message }`
- sidecar 构建为 JS（tsc 编译到 `sidecar/dist/`）
- Rust 端：启动 sidecar 子进程（开发期直接 `node sidecar/dist/index.js`），管道 stdin/stdout
- Rust ↔ WebView IPC：
  - `agent_prompt` command（WebView → Rust → sidecar stdin）
  - `agent_*` Tauri events（sidecar stdout → Rust → WebView）
- WebView 端基础对话 UI（临时，验证用）：输入框 + 流式输出显示
- 开发期 sidecar 用 `node` 直接运行，不打包（pkg 打包是 release 阶段）

## Acceptance Criteria

- [ ] `sidecar/package.json` 存在，`@earendil-works/pi-coding-agent` 已安装
- [ ] `sidecar/index.ts` 实现 stdio JSON lines 协议
- [ ] `sidecar/dist/index.js` 可通过 `node` 运行
- [ ] Rust 端能 spawn sidecar 子进程并管道 stdin/stdout
- [ ] `agent_prompt` IPC command 注册
- [ ] agent 事件（text_delta/tool_start/tool_end/agent_end/error）通过 Tauri events 转发到 WebView
- [ ] WebView 端能输入文本，收到 agent 流式回复并显示
- [ ] `npm run build` + `cargo check` 通过
- [ ] sidecar tsc 编译通过（`cd sidecar && npx tsc --noEmit`）

## Out of Scope

- 书籍读取工具（Child 4：get_toc/read_chapter/search_in_book/get_book_metadata）
- EPUB 解析库（Child 4）
- FTS5 索引（Child 4）
- 对话面板正式 UI（Child 4，本子任务只做临时验证 UI）
- 选段发送给 agent（Child 4）
- 多会话管理（Child 5，本子任务用 inMemory 单会话）
- pkg 打包（release 阶段）
- book_opened 消息（Child 4）