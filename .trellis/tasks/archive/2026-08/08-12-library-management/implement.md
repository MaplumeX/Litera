# Implement: Library Management

## Ordered Checklist

### 1. Rust 后端：书库持久化命令
- [ ] 1.1 定义数据结构 `BookRecord`、`ReadingSettings`、`OpenBookResult`（serde 序列化）
- [ ] 1.2 实现 `library.json` 读写（`read_library()` / `write_library()`，存 app data dir）
- [ ] 1.3 实现 `import_book` 命令：弹文件选择器 → 读字节 → 生成 bookId（路径 hash）→ 创建 `books/<id>/` 目录 → 复制 epub → 返回 `{ bytes, bookId }`
- [ ] 1.4 实现 `save_book_metadata` 命令：接收 bookId/title/author/coverBytes → 写 `cover.png` → 更新 library.json → 返回 BookRecord
- [ ] 1.5 实现 `list_books` 命令：读 library.json 返回所有 BookRecord
- [ ] 1.6 实现 `open_book` 命令：读 `books/<id>/book.epub` 字节 → 通知 sidecar `book_opened`（路径改为 app data 副本）→ 返回 bytes
- [ ] 1.7 实现 `delete_book` 命令：从 library.json 移除 + 删 `books/<id>/` 目录
- [ ] 1.8 实现 `update_reading_state` 命令：更新 library.json 中 book record 的 lastFraction / settings
- [ ] 1.9 注册所有新命令到 `invoke_handler`
- [ ] 1.10 配置 tauri.conf.json：启用 asset protocol scope（app data dir 的 books/ 目录）供封面图显示

### 2. 前端：LibraryView 组件
- [ ] 2.1 创建 `src/components/LibraryView.tsx`：封面网格 + 搜索栏 + 导入按钮 + 空状态提示
- [ ] 2.2 创建 `src/components/BookCard.tsx`：单本书卡片（封面图用 `convertFileSrc(coverPath)` + 书名 + 作者 + 删除按钮）
- [ ] 2.3 导入流程：`invoke('import_book')` → 拿到 bytes → 离屏用 foliate.js 打开提取 metadata + getCover() Blob → `invoke('save_book_metadata', { bookId, title, author, coverBytes })` → 刷新列表
- [ ] 2.4 搜索筛选：`list_books` 加载全部 → 前端按 title/author 实时过滤
- [ ] 2.5 删除：确认后 `invoke('delete_book', { bookId })` → 刷新列表

### 3. 前端：App.tsx 路由改造
- [ ] 3.1 新增 `view` 状态：`'library' | 'reader'`，启动默认 `'library'`
- [ ] 3.2 `view === 'library'` → 渲染 `<LibraryView onOpenBook={handleOpenBook} />`
- [ ] 3.3 `view === 'reader'` → 渲染现有阅读布局（ReaderView + ChatPanel）
- [ ] 3.4 `handleOpenBook(bookId)`：`invoke('open_book', { bookId })` → 拿到 bytes + BookRecord → setFileData + 保存 currentBookRecord → 切到 `'reader'`
- [ ] 3.5 保留顶部"打开文件"按钮改造为"导入"入口（调 import_book 流程，导入后可选直接打开或留在书库）
- [ ] 3.6 将 BookRecord（含 lastFraction + settings）传给 ReaderView

### 4. 验证
- [ ] 4.1 `npm run build` 前端编译通过
- [ ] 4.2 `cargo build` Rust 编译通过
- [ ] 4.3 手动测试：启动 → 书库空状态 → 导入 epub → 网格显示封面/书名/作者 → 关闭重开 → 书仍在
- [ ] 4.4 手动测试：搜索筛选 → 删除书 → 点击书进入阅读 → AI 对话正常
- [ ] 4.5 手动测试：重复导入同一 epub 不产生重复

## Validation Commands
```bash
cd /home/maplume/projects/Litera && npm run build
cd /home/maplume/projects/Litera/src-tauri && cargo build
```

## Risky Files / Rollback Points
- `src-tauri/src/lib.rs` — 新增命令 + 改动 open_file 逻辑，保留旧 open_file 兼容
- `src/App.tsx` — 路由重构，保留 ReaderView + ChatPanel 现有组合逻辑
- `src-tauri/tauri.conf.json` — asset protocol 配置变更

## Follow-up Before task.py start
- 确认 `convertFileSrc` + asset protocol 在 Tauri v2 的配置方式（查 Tauri v2 文档）
- 确认 foliate.js 离屏打开提取元数据的可行（不挂载到 DOM 能否调用 open + getCover）