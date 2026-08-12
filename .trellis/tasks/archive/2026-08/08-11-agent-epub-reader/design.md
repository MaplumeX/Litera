# Design: Agent-Enhanced EPUB Reader

## Architecture Overview

三进程架构：

```
┌─────────────────────────────────────────────────────────┐
│  Tauri App (Rust 主进程)                                 │
│  ┌──────────────────┐    ┌────────────────────────────┐ │
│  │ src-tauri (Rust) │    │ WebView (Chromium/WebKit)   │ │
│  │  - 文件对话框     │    │  React + foliate.js         │ │
│  │  - sidecar 管理   │◄──►│  - EPUB 渲染 (<foliate-view>)│ │
│  │  - IPC 转发       │IPC │  - 对话面板 UI              │ │
│  │  - 窗口管理       │    │  - 选段事件                 │ │
│  └────────┬─────────┘    └────────────────────────────┘ │
│           │ spawn + stdio                                 │
│  ┌────────▼─────────────────────────────────────────┐    │
│  │ pi agent sidecar (Node.js 二进制)                │    │
│  │  - createAgentSession / runRpcMode               │    │
│  │  - 自定义书籍读取工具                              │    │
│  │  - EPUB 解析库 (booqs/epub 或 epub)              │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Boundaries

### 1. WebView (React + foliate.js) — 渲染层
- 用 Tauri Rust API 打开原生文件对话框，获取 epub 文件路径
- 将文件读为 `File`/`Blob` 传给 `<foliate-view>.open()`
- 监听 `relocate` 事件跟踪当前章节索引和位置
- 监听 `selectionchange` / 自定义选段菜单，捕获选中文本 + CFI
- 对话面板：React 组件，通过 Tauri `invoke()` 与 Rust 通信

### 2. Tauri Rust 主进程 — 协调层
- `tauri-plugin-dialog`：原生文件选择器，返回 epub 绝对路径
- sidecar 管理：用 `tauri::api::process::Command::new_sidecar` 启动 pi agent 二进制
- IPC 桥接：
  - WebView → Rust → sidecar stdin（用户提问、选段上下文）
  - sidecar stdout → Rust → WebView（流式 agent 输出、工具调用事件）
- 将 epub 文件路径同时传给 WebView（渲染）和 sidecar（agent 工具读取）

### 3. pi agent sidecar (Node.js) — 智能层
- 用 `createAgentSession()` + `runRpcMode()` 或自定义 stdio JSON 协议
- 自定义工具（`defineTool`）：
  - `get_book_metadata` — 返回书名、作者、章节目录
  - `read_chapter` — 参数 `index`，返回该章节纯文本
  - `search_in_book` — 参数 `query`，返回匹配段落 + 章节索引
  - `get_toc` — 返回目录结构
- EPUB 解析：用 `booqs/epub`（TS，轻量）或 `epub`（julien-c，纯 JS）在 Node 进程直接读文件系统 epub
- 全文检索：SQLite FTS5 via `fts5-sql-bundle`（WASM，trigram tokenizer）
- 系统提示：定位为阅读助手，告诉 agent 可用工具及何时调用

## Data Flow

### 打开书籍
1. 用户触发"打开文件" → React 调 `invoke('open_file')`
2. Rust 弹原生对话框 → 返回 epub 绝对路径 `P`
3. Rust 读 `P` 为字节数组 → 经 IPC 返回 WebView
4. WebView 用 `new File([bytes], name)` 创建 Blob → `view.open(file)`
5. Rust 同时发消息给 sidecar：`{ type: "book_opened", path: P }`
6. sidecar 用 EPUB 解析库加载 `P`，缓存内存中的 book 对象

### 选段问答
1. 用户在 `<foliate-view>` 内选中文本 → React 捕获 selection + 当前章节 index
2. 用户在对话面板输入问题，点击发送
3. React 调 `invoke('agent_prompt', { prompt, selection, chapterIndex })`
4. Rust 转发给 sidecar：`{ type: "prompt", text, context: { selection, chapterIndex } }`
5. sidecar 构造完整 prompt（用户问题 + 选段上下文）→ `session.prompt()`
6. agent 可能调用 `read_chapter`/`search_in_book` 工具（在 sidecar 内本地执行，读 epub 文件）
7. sidecar 流式 stdout 事件 → Rust → WebView → React 流式渲染

### 全书/章节问答
1. 用户在对话面板输入问题（无选段）
2. 同上，但 context 不含 selection
3. agent 自主决定调用 `read_chapter`（当前章节）或 `search_in_book` 或 `get_toc`

## Contracts

### WebView ↔ Rust (Tauri IPC commands)
```typescript
// open_file: 弹文件选择器，返回 { path, bytes, bookId }
invoke<{ path: string; bytes: number[]; bookId: string }>('open_file')

// agent_prompt: 发送提问，返回流事件（通过 Tauri event）
invoke('agent_prompt', { prompt: string, selection?: string, chapterIndex?: number })

// 会话管理
invoke<{ sessions: SessionSummary[] }>('list_sessions', { bookId })
invoke<{ sessionId: string }>('new_session', { bookId })
invoke('switch_session', { sessionId })
invoke('delete_session', { sessionId })
// SessionSummary = { id, title, createdAt, updatedAt }

// agent 事件 (listen):
//   'agent_text_delta'    { delta: string }
//   'agent_tool_start'    { tool: string, params: object }
//   'agent_tool_end'      { result: string }
//   'agent_end'           {}
//   'session_history'     { messages: AgentMessage[] }  // 切换会话后加载历史
```

### Rust ↔ sidecar (stdio JSON lines)
```jsonl
{"type":"book_opened","path":"/abs/path.epub","bookId":"..."}
{"type":"new_session","bookId":"..."}
{"type":"switch_session","sessionId":"..."}
{"type":"delete_session","sessionId":"..."}
{"type":"list_sessions","bookId":"..."}
{"type":"prompt","text":"这段什么意思？","context":{"selection":"...","chapterIndex":3}}
{"type":"abort"}
```
```jsonl
{"type":"sessions_list","sessions":[{"id":"...","title":"...","createdAt":"...","updatedAt":"..."}]}
{"type":"session_switched","sessionId":"...","messages":[...]}
{"type":"session_deleted","sessionId":"..."}
{"type":"text_delta","delta":"这段在讨论..."}
{"type":"tool_start","tool":"read_chapter","params":{"index":3}}
{"type":"tool_end","result":"..."}
{"type":"agent_end"}
{"type":"error","message":"..."}
```

### Agent 工具定义（sidecar 内）
```typescript
const readChapterTool = defineTool({
  name: "read_chapter",
  description: "Read the full text of a chapter by its index from the TOC",
  parameters: Type.Object({ index: Type.Number() }),
  execute: async (_, { index }) => {
    const text = await currentBook.readChapterText(index)
    return { content: [{ type: "text", text }], details: {} }
  }
})
```

## Key Trade-offs

1. **双 EPUB 解析路径**（WebView foliate.js + sidecar epub 库）：解析两次，但进程隔离、架构清晰。替代方案是 WebView 提取文本经 IPC 传 sidecar，但跨进程传 DOM 数据复杂且耦合 foliate.js 内部状态。选双路径。

2. **sidecar 用 `pkg` 打包 Node.js**：增加 ~40MB 体积/平台。替代方案是要求用户预装 Node.js。选 pkg，保证零依赖安装体验。

3. **stdio JSON lines vs pi runRpcMode**：pi 自带 RPC 模式，但其协议面向编辑器集成。MVP 用自定义 stdio JSON lines 更简单可控，内部仍用 `createAgentSession()` + `session.subscribe()`。后续可评估切换 runRpcMode。

4. **选段上下文 vs 纯 agent 自主**：选段时把选中文本直接注入 prompt（agent 不需要工具取这段），但 agent 仍可调工具读更多章节上下文。兼顾即时性和自主性。

## Compatibility / Rollback

- 新项目，无迁移。Tauri `create-tauri-app` 脚手架起步。
- foliate.js 建议作为 git submodule 引入（上游推荐方式，API 不稳定）。
- sidecar 二进制在开发期直接用 `node` 运行 ts 源，仅 release 用 pkg 打包。

## Tool Set Confirmation

MVP 工具集（用户确认保留 `search_in_book`）：
- `get_book_metadata` — 书名/作者/语言/总章节数
- `get_toc` — 目录结构 `[{ index, label, href }]`
- `read_chapter` — 按章节索引读纯文本（从打开时缓存的章节文本 Map 返回）
- `search_in_book` — 全文检索，返回 `[{ chapterIndex, excerpt }]`

粒度选择：章节级（spine item），不用页码/CFI。选段文本直接注入 prompt，不走工具。

### 全文检索实现：SQLite FTS5 (WASM + trigram)

**方案**：`book_opened` 时提取全部章节纯文本，同时写入 SQLite FTS5 虚表建立索引。`search_in_book` 查询 FTS5 索引返回匹配段落。

**技术选型**（用户确认）：
- `fts5-sql-bundle`（sql.js 的第三方 FTS5 编译版，WASM，~1.7MB）
- trigram tokenizer（SQLite 3.34+ 内置）
- 不用 native better-sqlite3：避开 pkg 打包 native 模块的已知烫点（issue #261/#369/#1367）
- 不用 jieba 分词：jieba 是 C 扩展，只能配合 native 路径；trigram 对中文短语搜索够用，单字搜索不命中是可接受限制

**数据流**：
1. `book_opened` → EPUB 解析库提取各章节纯文本 → 缓存到 `Map<index, string>`（供 `read_chapter`）
2. 同步写入内存 SQLite FTS5 虚表 `CREATE VIRTUAL TABLE chapters USING fts5(content, tokenize='trigram')` + 逐章 INSERT
3. `search_in_book(query)` → `SELECT chapterIndex, snippet(chapters, ...) FROM chapters WHERE content MATCH ?` → 返回带高亮摘录的结果

**权衡**：
- WASM 比 native 慢 2-5x，但 FTS5 查询仍是毫秒级，用户无感知
- trigram 三字匹配：中文短语/句子片段搜索效果好，单字不命中
- 内存占用：章节文本 Map + FTS5 索引，典型 epub 1-5MB 可接受；极端大书留给 v2
- v2 升级路径：若需 jieba 精准分词，迁移到 native better-sqlite3 + simple-jieba，重新解决打包

## UI Layout & Interaction

### 组件库：shadcn/ui

- **shadcn/ui**（Radix UI 无样式原语 + Tailwind CSS，代码复制模式）：克制精致的桌面阅读器美学，源码在项目内完全可修改，按需引入零浪费
- 搭配 `react-resizable-panels`（可拖拽分栏，shadcn/ui 官方 Resizable 组件底层）
- 搭配 `react-markdown` + `remark-gfm`（agent 回答的 Markdown 渲染）
- Tauri React 模板配 Vite + TS，Tailwind 初始化一步完成

### 整体布局：固定分栏（A）

```
┌──────────────────────┬───────────────────┐
│  阅读区              │  对话面板           │
│  <foliate-view>      │  (可折叠可拖拽宽度)   │
│                      │                   │
└──────────────────────┴───────────────────┘
```

- 阅读区与对话面板竖直分栏，中间可拖拽分隔条调整宽度
- 对话面板可折叠（折叠后阅读区占满全宽，foliate.js 自动重新分页）
- <foliate-view> 是响应式自定义元素，容器宽度变化会自动重新分页，无需重新 open()

### 选段触发交互（a）

1. 用户在阅读区选中文本
2. 选区附近浮出“问 agent”小按钮
3. 点击 → 选段文本填入对话面板输入框 → 焦点转输入框
4. 用户输入问题，Enter 发送
5. 仅为复制而选中的文字不会误触发（需点按钮才填入）

### 对话面板内容

```
┌─ 对话面板 ──────────────────┐
│ [折叠] [会话列表]  阅读助手  │
├─────────────────────────────┤
│ (会话列表展开时覆盖此区域)    │
│ ┌ 会话 1: 第一章的疑问 ┐    │
│ │ 会话 2: 角色关系      │    │
│ │ + 新建会话            │    │
│ └───────────────────────┘    │
├─────────────────────────────┤
│  用户：这段在讲什么？        │
│  ┌ 选段 ──────────────┐    │
│  │ "..." (引用文本)    │    │
│  └────────────────────┘    │
│                             │
│  助手：🔧 read_chapter(3)   │
│  (折叠结果)                  │
│  这段讨论的是...             │
│  (流式输出)                  │
├─────────────────────────────┤
│ [输入框                ] [→]│
└─────────────────────────────┘
```

- 顶栏：折叠按钮、会话列表切换按钮
- 会话列表：覆盖式展开，列出当前书的所有会话，点击切换，“+ 新建会话”，每条可删除
- 消息列表：用户/助手交替，Markdown 渲染；选段引用块；工具调用卡片（可折叠）
- 流式输出：text_delta 事件实时追加到当前助手消息
- 输入框：固定底部，Enter 发送

## Session Management

### 模型：每书多会话，持久化，有列表 UI

- 每本书（bookId）可拥有多个独立会话
- 会话持久化到 Tauri app data 目录：`sessions/<bookId>/<sessionId>.jsonl`
- bookId = epub metadata identifier（优先）或文件路径 hash（fallback）
- 打开书时自动加载该书会话列表，默认切到最近更新的会话
- 切换会话 → sidecar 切换活跃 AgentSession → 加载该会话历史消息显示
- 新建会话 → sidecar 新建 AgentSession → 空对话面板
- 删除会话 → sidecar 释放会话 + 删除 jsonl 文件 → 从列表移除

### sidecar 实现

- 不再使用单个全局 AgentSession，改为 AgentSessionRuntime（支持 newSession/switchSession）
- 或自管 Map<sessionId, AgentSession>，切会话时 subscribe/ unsubscribe + 载入 messages
- 当前会话切换时：暂停旧的 subscribe，载入新会话 messages，重新 subscribe
- bookId 与 epub 解析状态仍全局保留（换会话不换书，FTS5 索引/章节缓存不变）

### 会话标题

- MVP：用首条用户消息截断前 30 字符作为默认标题（无需用户手动重命名，重命名列入 v2 Out of Scope）
- 列表 UI 显示标题 + updatedAt 时间

### 权衡

- 同一本书的多个会话共享同一份书籍缓存（EPUB 文本 Map + FTS5 索引），不会重复解析
- 长会话上下文膨胀由 pi 的自动 compaction 处理（SessionManager 默认开启）
- 会话重命名、跨书全局会话搜索、会话导出 → v2 Out of Scope

## Risks / Deferred

- foliate.js API 不稳定 → submodule 锁定 commit
- pi sidecar 进程管理（崩溃恢复、超时）→ MVP 最小：启动时 spawn，关闭时 kill；v2 加 watchdog
- 大 epub 性能（sidecar 全量解析 + FTS5 索引建立）→ MVP 接受；v2 按需加载章节 + 懒索引
- CSP 安全（foliate.js 要求阻止 epub 内脚本）→ Tauri 配置 CSP，MVP 必须包含
- trigram 中文单字搜索不命中 → MVP 可接受；v2 评估 jieba/native 路径