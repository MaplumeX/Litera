# Agent-Enhanced EPUB Reader

## Goal

构建一款 AI agent 加持的跨平台桌面 EPUB 阅读器，将 foliate.js 的 EPUB 渲染能力与 pi agent 的对话/工具能力结合，为读者提供阅读中即时智能辅助（问答、总结、翻译、词汇解释等）。

## User Value

读者在阅读电子书时无需切换应用即可获得 AI 辅助：选中段落即可提问，或就全书/章节提问，agent 自主调用工具读取书籍内容来回答，降低深度阅读的摩擦。

## Background / Confirmed Facts

技术栈已由用户指定：

- **Tauri** — 跨平台桌面应用框架（Rust 后端 + Web 前端）。目标平台：Windows + macOS + Linux 三平台全支持。
- **foliate.js** (`johnfactotum/foliate-js`) — 纯 JS ES 模块库，无构建步骤，可直接 import；支持 EPUB/MOBI/FB2/CBZ/PDF；接受 `File`/`Blob` 打开书籍；内置 demo `reader.html`。
- **pi agent** — pi 提供 `createAgentSession()` SDK（`@earendil-works/pi-coding-agent`），可嵌入其他应用；支持自定义模型、工具、扩展（`defineTool`）；有 `pi-agent-sdk-starter` 桌面应用起始套件可参考。
- **架构约束（研究确认）**：pi SDK 是纯 Node.js 包；Tauri 后端是 Rust、WebView 是浏览器环境（无 Node.js）。因此 pi agent 需以 **sidecar 子进程**方式运行，通过 stdio JSON lines 与 Tauri 通信。Tauri 官方支持 sidecar（`externalBin` + target-triple 命名），用 `pkg` 将 Node.js 打包为单文件二进制。
- **书籍读取工具架构**：agent 的书籍读取工具在 Node.js 进程内用独立 EPUB 解析库（候选 `booqs/epub` / `epub`）直接读文件系统上的 epub 文件（foliate.js 只负责 WebView 内 UI 渲染，两者共享同一文件路径）。不依赖 WebView DOM 跨进程取数据。

### 参考项目（研究得到）

| 项目 | 相关性 |
|------|--------|
| `bubao/tauri-reader` | Tauri + foliate-js 直接先例 |
| `fundaments-work/Theorem` | Tauri 本地优先阅读器，多格式 + 高亮 + 词典 + TTS |
| `readest` | Next.js 15 + Tauri v2，Foliate 的现代重写，跨平台含移动端 |
| `yicheng47/quill` | **agent 加持阅读器**：选中文本即问 AI，支持 OpenAI/Anthropic/Ollama，词汇卡 + 间隔重复 |
| `vanzan01/pi-agent-sdk-starter` | Pi SDK 桌面应用起始套件 |

## Key Decisions

- **目标平台 = Windows + macOS + Linux**：三平台全支持。pi sidecar 需为每平台打包 Node.js 运行时。
- **前端框架 = React**：Tauri 官方 `create-tauri-app` 提供 React 模板；可参考 `react-book-reader`（foliate.js 的 React 包装）。构建工具用 Vite。
- **MVP 范围 = 方案 A（最小）**：选段问答 + 全书/章节问答。
- **Agent 架构 = 工具模式，非 RAG**：agent 本身不预加载书籍内容，而是拥有读取书籍的工具（`get_toc`、`read_chapter`、`search_in_book`、`get_book_metadata`），agent 自主调用工具按需获取内容来回答。不引入 embedding/向量库基础设施。

## Requirements

- 用户能打开 EPUB 文件并在应用内阅读（基于 foliate.js 渲染）。
- 用户能选中文本段落，向 agent 提问关于该段落的问题。
- 用户能就全书或当前章节向 agent 提问。
- Agent 通过调用工具读取书籍内容（非预检索/RAG），自主决定读取哪些内容来回答。
- Agent 对话在应用内侧边栏/面板中进行，不离开阅读界面。
- 每本书支持多个独立会话，用户可新建、切换、删除会话，会话历史持久化。
- 支持三平台：Windows、macOS、Linux。

## Acceptance Criteria

- [ ] 能通过文件选择器打开 `.epub` 文件并正确渲染分页阅读。
- [ ] 能选中文本，选中文本作为上下文传入 agent 发起提问。
- [ ] Agent 能调用书籍读取工具获取章节/页面内容并据此回答。
- [ ] Agent 对话面板与阅读视图同屏共存（固定分栏），不遮挡当前阅读内容。
- [ ] 用户能在当前书内新建会话、在会话列表间切换、删除会话。
- [ ] 关闭并重开同一本书后，之前的会话历史恢复。
- [ ] 应用可在 Windows、macOS、Linux 三平台启动运行。

## Out of Scope

- 章节总结、词汇解释、翻译、TTS（v2 候选）
- 向量库 / embedding / RAG 预处理流水线
- 高亮标注、书签、笔记管理（v2 候选）
- 云端同步、书库管理（v2 候选）
- 移动端（iOS/Android）
- sidecar 崩溃恢复 watchdog、大 epub 按需加载优化（v2）
- 会话重命名、跨书全局会话列表、会话搜索（v2 候选）

## Open Questions

（无——所有产品决策已解决，技术未知项在 design.md 中研究解决）