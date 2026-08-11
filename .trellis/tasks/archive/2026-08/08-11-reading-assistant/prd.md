# Reading Assistant Integration

## Goal

整合前三层（foliate.js 渲染 + pi agent sidecar + 书籍读取工具），实现完整 MVP 问答闭环：打开书 → 选段/章节提问 → agent 调工具读章节/搜索 → 流式回答。

## Parent Reference

父任务：`08-11-agent-epub-reader`。本子任务对应 `implement.md` Child 4。依赖 Child 2（EPUB 渲染）+ Child 3（pi sidecar），均已完成。

## Requirements

### sidecar 端
- 安装 EPUB 解析库（`booqs/epub` 或 `epub`）+ `fts5-sql-bundle`（WASM FTS5）
- 实现 `book_opened` 消息处理：加载 epub，提取各章节纯文本缓存到 `Map<index, string>`
- `book_opened` 时同步建立 SQLite FTS5 索引：`CREATE VIRTUAL TABLE chapters USING fts5(content, tokenize='trigram')` + 逐章 INSERT
- 定义 4 个自定义工具（`defineTool`）：
  - `get_book_metadata` — 返回书名/作者/语言/总章节数
  - `get_toc` — 返回目录结构 `[{ index, label, href }]`
  - `read_chapter` — 参数 `{ index }`，从缓存 Map 返回章节纯文本
  - `search_in_book` — 参数 `{ query }`，查 FTS5 + `snippet()` 高亮，返回 `[{ chapterIndex, excerpt }]`
- 系统提示：定位为阅读助手，描述可用工具及使用时机
- 在 `createAgentSession` 中注册自定义工具（`customTools`）
- `book_opened` 后 agent 工具可用；未 open book 时工具返回错误提示

### Rust 端
- `open_file` 成功后同时发 `book_opened` 给 sidecar（含 path + bookId）
- bookId 计算：epub metadata identifier（优先）或文件路径 hash（fallback）——本子任务可先用文件路径 hash 简化，Child 5 再完善

### WebView 端（正式对话面板，替换 Child 3 临时 UI）
- 固定分栏布局：阅读区 ┃ 对话面板，用 `react-resizable-panels`，可拖拽宽度可折叠
- 对话面板组件（替换临时 ChatPanel）：
  - 消息列表：用户/助手交替，Markdown 渲染（`react-markdown` + `remark-gfm`）
  - 选段引用块：用户消息内嵌选中文本（视觉区分）
  - 工具调用卡片：可折叠，显示工具名 + 参数 + 可展开看返回结果
  - 流式输出：text_delta 事件实时追加到当前助手消息
  - 输入框：固定底部，Enter 发送
- 选段触发整合：选中文字 → 浮出"问 agent"按钮 → 点击填入输入框 + 聚焦（Child 2 已实现捕获，本子任务接上发送）
- 选段问答：选中文本 + chapterIndex 注入 prompt context（sidecar 端构造完整 prompt）

## Acceptance Criteria

- [ ] sidecar 安装 EPUB 解析库 + fts5-sql-bundle
- [ ] `book_opened` 消息处理：加载 epub + 提取章节文本缓存 + 建 FTS5 索引
- [ ] 4 个自定义工具定义并注册到 agent session
- [ ] 系统提示定位为阅读助手
- [ ] Rust `open_file` 成功后发 `book_opened` 给 sidecar
- [ ] 固定分栏布局（react-resizable-panels），可拖拽可折叠
- [ ] 对话面板：消息列表 + Markdown 渲染 + 选段引用块 + 工具卡片（可折叠）
- [ ] 流式输出实时追加
- [ ] 选段触发：选中 → 浮出按钮 → 点击填入输入框 + 发送
- [ ] `npm run build` + `cargo check` + `cd sidecar && npx tsc --noEmit` 通过
- [ ] 完整闭环逻辑正确（打开书 → 选中段落 → 问 agent → agent 调工具 → 回答）

## Out of Scope

- 多会话管理（Child 5）
- 会话列表 UI（Child 5）
- 会话持久化（Child 5）
- 章节总结/词汇解释/翻译/TTS（v2）
- pkg 打包（release）