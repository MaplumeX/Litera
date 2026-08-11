# Implementation Plan: Agent-Enhanced EPUB Reader

## Task Decomposition

父任务 `agent-epub-reader` 拆分为 5 个可独立验证的子任务：

| # | 子任务 | 依赖 | 可独立验证 |
|---|--------|------|-----------|
| 1 | Tauri + React 脚手架 | — | `npm run tauri dev` 启动空窗口 |
| 2 | EPUB 渲染（foliate.js 集成） | 1 | 打开 epub 并分页阅读 |
| 3 | pi agent sidecar 集成 | 1 | sidecar 启动，能收到 prompt 并回复（无书籍工具） |
| 4 | 阅读助手整合（工具 + 选段 + 对话面板） | 2, 3 | 完整 MVP 问答闭环 |
| 5 | 多会话管理 + 列表 UI | 4 | 新建/切换/删除会话，重开书恢复历史 |

子任务 2 和 3 可并行（都只依赖 1）。子任务 4 依赖 2+3。子任务 5 依赖 4。

## Ordered Checklist

### Child 1: Tauri + React 脚手架
- [ ] `npm create tauri-app@latest Litera -- --template react-ts`（或在本仓库内初始化）
- [ ] 配置 Vite + React + TypeScript
- [ ] 初始化 Tailwind CSS + shadcn/ui（`npx shadcn@latest init`）
- [ ] 安装 `react-resizable-panels`（分栏布局）
- [ ] 安装 `react-markdown` + `remark-gfm`（agent 回答 Markdown 渲染）
- [ ] 验证 `npm run tauri dev` 启动空窗口
- [ ] 添加 `tauri-plugin-dialog` 依赖
- [ ] 配置 CSP（阻止 epub 内脚本，foliate.js 安全要求）
- [ ] 建立目录结构：`src/`（React）、`src-tauri/`（Rust）、`sidecar/`（pi agent）

### Child 2: EPUB 渲染（foliate.js）
- [ ] 将 `foliate-js` 作为 git submodule 添加到 `src/foliate-js/`
- [ ] 创建 `ReaderView` React 组件：挂载 `<foliate-view>` 自定义元素
- [ ] 实现 `openFile`：Rust command `open_file` → 返回 path + bytes → WebView `new File([bytes])` → `view.open(file)`
- [ ] 监听 `relocate` 事件，向上传递当前 chapterIndex / fraction
- [ ] 基础阅读 UI：上一页/下一页按钮、章节进度
- [ ] 选段捕获：监听 selection，弹出"问 agent"按钮，记录选中文本 + chapterIndex
- [ ] 验证：能打开 `.epub`、分页浏览、选中文字

### Child 3: pi agent sidecar
- [ ] `sidecar/` 目录：`npm init`，安装 `@earendil-works/pi-coding-agent`
- [ ] 实现 `sidecar/index.ts`：`createAgentSession()` + `SessionManager.inMemory()` + `session.subscribe()` 事件转 stdio JSON lines
- [ ] stdio 协议：读 stdin（prompt/abort），写 stdout（text_delta/tool_start/tool_end/agent_end/error）
- [ ] Rust 端：`tauri::api::process::Command::new_sidecar("pi-agent")` spawn，管道 stdio
- [ ] Rust ↔ WebView IPC：`agent_prompt` command + `agent_*` events
- [ ] 开发期直接 `node sidecar/dist/index.js`（ts-node 或先 tsc）
- [ ] 验证：在 Tauri 应用里输入"hello"，收到 agent 流式回复

### Child 4: 阅读助手整合
- [ ] sidecar 安装 EPUB 解析库（`booqs/epub` 或 `epub`）+ `fts5-sql-bundle`（WASM FTS5）
- [ ] sidecar 实现 `book_opened` 消息：加载 epub，提取各章节纯文本缓存到 `Map<index, string>`
- [ ] `book_opened` 同步建立 SQLite FTS5 索引：`CREATE VIRTUAL TABLE chapters USING fts5(content, tokenize='trigram')` + 逐章 INSERT
- [ ] 定义自定义工具：`get_toc`、`read_chapter`（从缓存 Map）、`search_in_book`（查 FTS5 + `snippet()` 高亮）、`get_book_metadata`
- [ ] 系统提示：定位为阅读助手，描述可用工具
- [ ] Rust：`open_file` 成功后同时发 `book_opened` 给 sidecar（含 bookId）
- [ ] 对话面板 React 组件：固定分栏布局，可折叠可拖拽宽度
- [ ] 消息列表：用户/助手交替，Markdown 渲染，选段引用块，工具调用卡片（可折叠）
- [ ] 选段触发：选中文字 → 浮出“问 agent”按钮 → 点击填入输入框 + 聚焦
- [ ] 选段问答：选中文本 + chapterIndex 注入 prompt context
- [ ] 流式渲染：text_delta 事件实时追加到当前助手消息
- [ ] 验证完整闭环：打开书 → 选中段落 → 问 agent → agent 调工具读章节/搜索 → 回答
- [ ] 验证中文搜索：trigram tokenizer 对中文短语搜索可用

### Child 5: 多会话管理 + 列表 UI
- [ ] sidecar：单 AgentSession → AgentSessionRuntime 或自管 Map<sessionId, AgentSession>
- [ ] sidecar 实现会话命令：`new_session` / `switch_session` / `delete_session` / `list_sessions`
- [ ] 会话持久化：`SessionManager.create(booksDir)`，存储路径 `sessions/<bookId>/<sessionId>.jsonl`
- [ ] bookId 计算：epub metadata identifier 优先，文件路径 hash fallback
- [ ] 切换会话：载入该会话 messages → 发 `session_switched` + 历史 → 前端渲染历史
- [ ] 会话标题：首条用户消息截断前 30 字符
- [ ] Rust IPC commands：`list_sessions` / `new_session` / `switch_session` / `delete_session`
- [ ] Rust：`open_file` 成功后自动调用 `list_sessions(bookId)` → 前端默认切到最近更新的会话
- [ ] 前端会话列表 UI：顶栏“会话列表”按钮 → 覆盖式展开 → 列表 + “+ 新建会话” + 每条可删除
- [ ] 切换会话时清空当前消息，渲染新会话历史
- [ ] 验证：新建多个会话 → 切换间对话独立 → 删除会话从列表移除
- [ ] 验证：关闭并重开同一本书 → 之前会话列表恢复 → 选某会话 → 历史消息恢复

## Validation Commands

```bash
# 脚手架
npm run tauri dev          # 启动开发

# 类型检查
npm run typecheck          # 前端
cd sidecar && npx tsc --noEmit   # sidecar

# 构建
npm run tauri build        # 生产构建（含 sidecar 打包）
```

## Risky Areas / Rollback Points

- **foliate.js submodule 锁定**：记录 commit hash；若 API 变更破坏，回退到已知 hash
- **sidecar 启动失败**：Rust 端日志记录 sidecar stderr；开发期用 `--sidecar-stdio` 调试
- **pkg 打包兼容性**：pi 依赖可能含 native 模块；若 pkg 失败，fallback 为打包 Node.js runtime + 脚本（Tauri 文档备选方案）
- **CSP 误拦 foliate.js**：foliate.js 用 blob: URL 渲染章节，CSP 需允许 `blob:` src；逐步调试

## Pre-`task.py start` Checks

- [ ] `prd.md`、`design.md`、`implement.md` 审阅通过
- [ ] `implement.jsonl` / `check.jsonl` 含真实 spec/research 条目
- [ ] 子任务创建命令就绪
- [ ] 用户批准最终规划摘要