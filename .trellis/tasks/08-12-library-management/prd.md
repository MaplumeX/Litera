# Library Management

## Parent

`08-12-library-reader-ux` — Library & Reader UX Overhaul

## Goal

为 Litera 新增完整的书库管理能力：应用启动进入书库视图，支持导入 epub（复制到 app data）、封面/书名/作者网格展示、搜索筛选、删除书籍，并为阅读界面提供"从书库打开书"的入口。

## User Value

用户获得主流阅读软件的书库体验：启动看到自己的书架而非空阅读器，导入的书持久保存、可搜索、可删除，点击即可开始阅读。

## Background / Confirmed Facts

### 现有代码状态（已勘察）

- **应用入口**（`src/App.tsx`）：启动即为空阅读视图，顶部"打开文件"按钮 → `invoke('open_file')` → 直接阅读 + 聊天分栏。无书库概念。
- **`open_file` 命令**（`src-tauri/src/lib.rs`）：弹原生对话框 → 读字节 → 返回 `{ path, name, bytes, bookId }`，同时通知 sidecar `book_opened`。`bookId` 为文件路径 hash。
- **`ReaderView`**（`src/components/ReaderView.tsx`）：接受 `fileData: { bytes, name }`，用 `new File([bytes], name)` 创建 Blob 传给 `foliate-view.open()`。
- **`ChatPanel`**（`src/components/ChatPanel.tsx`）：接受 `bookId` 驱动多会话管理，功能完整不改动。
- **Tauri 配置**：`tauri-plugin-dialog` 已引入；app data 目录可用 `app.path().app_data_dir()`。
- **CSP**：`img-src 'self' blob: data:` — 允许封面 Blob URL 显示。
- **foliate.js**：`book.metadata`（含 title/author）、`book.getCover()`（返回 Blob）可用于书库元数据与封面。

### 技术约束

- 书籍文件存储 = 复制到 Tauri app data 目录 `books/<bookId>/book.epub`。
- 书库元数据持久化存储在 app data 目录（JSON 文件 `library.json` 或 SQLite，见 design.md）。
- `bookId` 沿用现有生成方式（文件路径 hash）或改用 epub metadata identifier（design.md 决定）。
- 不改动 sidecar / agent 工具协议，但 `book_opened` 通知需适配新打开路径。

## Key Decisions

- **文件存储 = 复制到 app data**：导入时复制 epub 到 `books/<bookId>/book.epub`，删除时删除记录 + 目录。
- **元数据提取 = 前端 foliate.js**：导入时在 WebView 用 foliate.js 打开文件提取 `metadata`（title/author）+ `getCover()` Blob，转为元数据记录 + 封面图存到 app data，再由 Rust 持久化。
- **打开书 = 读 app data 副本**：从书库点击书 → Rust 读 `books/<bookId>/book.epub` 字节返回 WebView 渲染。

## Requirements

### 书库视图
- 应用启动默认进入书库视图（非空阅读视图）。
- 书库视图展示已导入书籍的封面网格：封面、书名、作者。
- 书库视图有"导入"按钮（替代/改造现有"打开文件"按钮）。
- 空书库时展示引导提示（如"还没有书籍，点击导入"）。

### 导入
- 用户点击"导入"按钮 → 打开文件选择器选择 `.epub` 文件。
- 导入时将 epub 文件复制到 Tauri app data 目录 `books/<bookId>/book.epub`。
- 导入时提取书籍元数据（书名、作者、封面）并持久化。
- 导入后书库网格立即显示新书。
- 重复导入同一文件不创建重复记录（按 bookId 去重）。

### 持久化
- 书库元数据持久化到 app data 目录，重开应用后书库仍在。
- 每本书的阅读位置（fraction）持久化，重开同一本书自动恢复（与子任务 reader-enhancement 共用存储，此任务提供存储基础设施）。

### 搜索/筛选
- 书库支持按书名/作者搜索筛选（实时输入即时筛选）。

### 删除
- 用户能从书库删除书籍。
- 删除时删除元数据记录 + `books/<bookId>/` 目录（含 epub 副本与封面）。

### 打开书籍
- 从书库点击一本书 → 进入阅读界面，用持久化的 app data 副本路径打开。
- `open_file` 命令保留为"导入新书的途径"（仍可弹对话框，但语义变为导入）。

## Acceptance Criteria

- [ ] 应用启动默认显示书库视图，非空阅读视图。
- [ ] 能通过"导入"按钮选择 `.epub` 文件，导入后书库中显示该书封面/书名/作者。
- [ ] 关闭并重开应用后，书库中的书籍仍在（持久化）。
- [ ] 能在书库中按书名/作者搜索/筛选书籍。
- [ ] 能从书库删除书籍，删除后不再出现在书库中。
- [ ] 点击书库中的书 → 进入阅读界面，正确渲染分页阅读。
- [ ] 重复导入同一 epub 不产生重复记录。
- [ ] 现有 AI 对话面板（选段问答、多会话、流式输出）在从书库打开书后仍正常工作。

## Dependencies

- 本任务提供"从书库点击书进入阅读"的入口与数据流，reader-enhancement 任务的"返回书库"依赖此书库视图存在。
- 阅读位置持久化的存储基础设施在本任务建立，reader-enhancement 任务负责在 relocate 事件中写入位置。

## Out of Scope

- 书籍分类/标签/自定义集合（v2 候选）
- 书库排序方式切换（v2 候选）
- 阅读界面增强（目录/字体/主题）——由 `08-12-reader-enhancement` 负责
- sidecar / agent 工具协议改动

## Open Questions

（无——所有产品决策已解决，技术未知项在 design.md 中研究解决）