# Design: Library & Reader UX Overhaul (Parent)

## Role

父任务管理两个独立子任务的协调与最终集成验收，本身不直接实现：

- **`08-12-library-management`** — 书库视图 + Rust 持久化 + 导入/删除/搜索/打开书
- **`08-12-reader-enhancement`** — 目录侧边栏 + 字体/主题调节 + 位置恢复 + 返回书库

## Cross-Child Contracts

### 共享数据结构（由 library-management 定义，reader-enhancement 消费）

```typescript
// BookRecord — library-management 的 list_books/open_book 返回
interface BookRecord {
  id: string;
  title: string;
  author: string;
  coverPath: string;    // app data 绝对路径
  filePath: string;     // app data 绝对路径
  importedAt: string;
  lastFraction?: number;       // reader-enhancement 写入
  settings?: ReadingSettings;  // reader-enhancement 写入
}

// update_reading_state 命令 — library-management 提供，reader-enhancement 调用
invoke<void>('update_reading_state', {
  bookId: string,
  lastFraction?: number,
  settings?: { fontSize?: number; fontFamily?: string; theme?: string }
})
```

### 依赖顺序

1. library-management 先实现：建立书库视图 + Rust 持久化命令 + App.tsx 路由（`view: 'library' | 'reader'`）
2. reader-enhancement 后实现：在 reader 视图中补齐目录/字体/主题/位置恢复 + 返回书库按钮接线

### App.tsx 路由（由 library-management 建立）

- `view: 'library' | 'reader'`，启动默认 `'library'`
- `handleOpenBook(bookId)` → `invoke('open_book')` → bytes + BookRecord → 切到 `'reader'`，传 BookRecord 给 reader 视图
- reader 视图的"返回书库"按钮 → 切回 `'library'`（reader-enhancement 接线）

## Integration Acceptance (Parent-Level)

完成两个子任务后，父任务验证端到端流程：
- [ ] 启动 → 书库 → 导入 epub → 点击书 → 阅读（目录/字体/主题可用）→ 返回书库 → 重进同一书（位置/设置恢复）
- [ ] AI 对话面板在整个流程中不受影响

## Out of Scope

父任务不重复子任务的设计细节，见各自 design.md。