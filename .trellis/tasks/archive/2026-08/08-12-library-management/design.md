# Design: Library Management

## Architecture

新增书库管理层，位于现有架构的协调层（Rust）与渲染层（React）之间：

```
┌──────────────────────────────────────────────────────────┐
│  React (WebView)                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ LibraryView  │  │ App.tsx      │  │ ReaderView     │ │
│  │ (新增)        │←→│ (路由切换)    │  │ (现有，小改)    │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────┘ │
│         │ invoke()         │                   │        │
├─────────┼──────────────────┼───────────────────┼────────┤
│  Rust (src-tauri)                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 书库命令 (新增)                                       │ │
│  │  - import_book / list_books / delete_book             │ │
│  │  - open_book / update_reading_state                  │ │
│  │  - 持久化: library.json + books/<id>/ 目录             │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ sidecar 管理 (现有，不改动)                           │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Boundaries

### 1. React (WebView) — 渲染层

**新增 `LibraryView` 组件**：
- 封面网格展示（`<BookCard>` 子组件：封面图 + 书名 + 作者）
- 顶部工具栏：搜索输入框 + 导入按钮
- 空状态提示
- 点击书 → 回调 `onOpenBook(bookId)` 给 App 路由到阅读界面

**改造 `App.tsx`**：
- 新增 `view` 状态：`'library' | 'reader'`
- 启动默认 `'library'`
- `onOpenBook` → 切到 `'reader'`，加载该书 bytes 给 ReaderView
- ReaderView 的"返回书库"按钮 → 切回 `'library'`

**`ReaderView` 小改**：
- 接受 `fileData` 来源从"文件选择器"改为"书库记录的 app data 路径"
- 新增 `onBackToLibrary` 回调（由 reader-enhancement 任务接线，此任务仅提供数据流）

### 2. Rust (src-tauri) — 持久化层

**新增 Tauri 命令**：

```rust
// 导入书籍：弹文件选择器 → 复制到 app_data/books/<bookId>/ → 返回元数据
#[tauri::command]
async fn import_book(app: tauri::AppHandle) -> Result<BookRecord, String>

// 列出书库所有书籍
#[tauri::command]
fn list_books(app: tauri::AppHandle) -> Result<Vec<BookRecord>, String>

// 删除书籍：删元数据 + books/<bookId>/ 目录
#[tauri::command]
fn delete_book(app: tauri::AppHandle, book_id: String) -> Result<(), String>

// 从书库打开书：读 books/<bookId>/book.epub 字节返回
#[tauri::command]
async fn open_book(app: tauri::AppHandle, book_id: String) -> Result<OpenBookResult, String>

// 更新阅读位置/设置（被 reader-enhancement 任务调用）
#[tauri::command]
fn update_reading_state(
    app: tauri::AppHandle, book_id: String,
    last_fraction: Option<f64>,
    settings: Option<ReadingSettings>
) -> Result<(), String>
```

**数据结构**：

```rust
#[derive(Serialize, Deserialize, Clone)]
struct BookRecord {
    id: String,           // epub metadata identifier 或路径 hash
    title: String,
    author: String,
    cover_path: String,   // app_data/books/<id>/cover.png（绝对路径）
    file_path: String,     // app_data/books/<id>/book.epub（绝对路径）
    imported_at: String,   // ISO 时间戳
    last_fraction: Option<f64>,
    settings: Option<ReadingSettings>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ReadingSettings {
    font_size: Option<f64>,
    font_family: Option<String>,
    theme: Option<String>,  // "light" | "dark" | "sepia"
}

#[derive(Serialize)]
struct OpenBookResult {
    bytes: Vec<u8>,
    name: String,
    book_id: String,
}
```

### 3. 持久化存储

**目录结构**（Tauri app data dir）：
```
<app_data>/
├── library.json          # 书库元数据索引
├── books/
│   ├── <bookId>/
│   │   ├── book.epub      # epub 副本
│   │   └── cover.png      # 封面图
│   └── <bookId>/
│       ├── book.epub
│       └── cover.png
└── sessions/             # 现有，不改动
    └── <bookId>/
```

**`library.json`**：
```json
{
  "books": [
    {
      "id": "abc123",
      "title": "书名",
      "author": "作者",
      "coverPath": ".../books/abc123/cover.png",
      "filePath": ".../books/abc123/book.epub",
      "importedAt": "2026-08-12T...",
      "lastFraction": 0.42,
      "settings": { "fontSize": 18, "fontFamily": "serif", "theme": "dark" }
    }
  ]
}
```

## Data Flow

### 导入书籍
1. 用户在 LibraryView 点击"导入" → React 调 `invoke('import_book')`
2. Rust 弹文件选择器 → 选 epub → 读文件字节
3. Rust 生成 bookId（epub metadata identifier 或路径 hash）
4. Rust 创建 `books/<bookId>/` 目录 → 复制 epub 到 `book.epub`
5. Rust 返回 `{ bytes, bookId }` 给前端（前端需 bytes 来用 foliate.js 提取元数据 + 封面）
6. 前端用 foliate.js 打开 bytes → `book.metadata`（title/author）+ `book.getCover()`（Blob）
7. 前端将封面 Blob 转 ArrayBuffer → 调 `invoke('save_book_metadata', { bookId, title, author, coverBytes })`
8. Rust 写 `cover.png` + 更新 `library.json` → 返回完整 `BookRecord`
9. 前端刷新书库网格

> **替代方案**：在 Rust 端用 epub 解析库提取元数据（如 `epub` crate），避免前端往返。权衡：Rust 端需引入 epub 依赖 + 解析逻辑，但避免前端临时打开 foliate-view 提取的开销。选**前端提取**：foliate.js 已在 WebView 中，提取元数据无额外依赖，且封面 Blob 前端可直接预览。

### 打开书
1. 用户点击书 → React 调 `invoke('open_book', { bookId })`
2. Rust 读 `books/<bookId>/book.epub` 字节 → 返回 `{ bytes, name, bookId }`
3. Rust 同时通知 sidecar `book_opened`（沿用现有逻辑，路径改为 app data 副本路径）
4. 前端用 bytes 创建 File → `foliate-view.open(file)`
5. 前端从 library.json 记录读取 `lastFraction` + `settings` → 传给 ReaderView 恢复

### 删除书
1. 用户点删除 → React 调 `invoke('delete_book', { bookId })`
2. Rust 从 `library.json` 移除记录
3. Rust 删除 `books/<bookId>/` 目录
4. 返回成功 → 前端刷新网格

### 搜索筛选
- 纯前端：`list_books` 返回全部记录，前端按搜索词过滤 title/author（实时输入即时过滤）。无需 Rust 端搜索命令。

## Contracts

### WebView ↔ Rust (Tauri IPC)

```typescript
// 导入书籍（弹选择器，复制文件，返回临时数据供前端提取元数据）
invoke<{ bytes: number[]; bookId: string }>('import_book')

// 保存提取的元数据 + 封面
invoke<BookRecord>('save_book_metadata', {
  bookId: string, title: string, author: string, coverBytes: number[]
})

// 列出所有书
invoke<BookRecord[]>('list_books')

// 打开书（读副本字节）
invoke<{ bytes: number[]; name: string; bookId: string }>('open_book', { bookId })

// 删除书
invoke<void>('delete_book', { bookId })

// 更新阅读位置/设置
invoke<void>('update_reading_state', {
  bookId: string,
  lastFraction?: number,
  settings?: ReadingSettings
})

// BookRecord = { id, title, author, coverPath, filePath, importedAt, lastFraction?, settings? }
// ReadingSettings = { fontSize?: number, fontFamily?: string, theme?: string }
```

### 封面图片显示
- `coverPath` 是绝对路径。Tauri WebView 不能直接 `file://` 访问 app data（CSP 限制）。
- **方案**：新增 `get_cover` 命令返回封面字节，或用 Tauri 的 `convertFileSrc()` 将路径转为可访问的 `asset://` URL。
- **选 `convertFileSrc`**：Tauri 内置，配合 `tauri.conf.json` 的 `assetProtocol` 配置，前端 `<img src={convertFileSrc(coverPath)}>` 即可。需在 tauri.conf.json 的 security 中启用 asset protocol scope。

## Key Trade-offs

1. **元数据提取在前端 vs Rust**：选前端（foliate.js 已可用，无需 Rust epub 依赖），代价是导入时前端需临时打开 foliate-view 提取。
2. **library.json vs SQLite**：选 JSON（书库规模小，通常几十到几百本，无需查询性能），SQLite 是 v2 升级路径。
3. **封面显示用 convertFileSrc vs 读取字节**：选 convertFileSrc（Tauri 原生方案，避免每次加载读字节的开销）。
4. **bookId 生成**：沿用现有路径 hash，但改为 app data 副本路径的 hash（导入后路径固定，hash 稳定）。若同一文件重复导入，hash 相同 → 去重。

## Compatibility / Rollback

- 现有 `open_file` 命令保留（兼容旧入口），但 `App.tsx` 改为书库优先，`open_file` 作为导入入口。
- sidecar `book_opened` 通知逻辑不变，仅路径来源改为 app data 副本。
- sessions/ 目录结构与现有兼容，bookId 生成方式不变（路径 hash），但路径变为 app data 副本路径 → **会导致现有会话与 bookId 不匹配**。这是破坏性变更：导入到书库后 bookId 变化，旧会话历史丢失。**可接受**（当前是早期开发，无真实用户数据）。

## Risks / Deferred

- 大书库（>1000 本）JSON 读写性能 → MVP 可接受；v2 迁移 SQLite
- 封面提取失败的降级（无封面的 epub）→ 显示占位图 + 书名首字
- import 时前端临时打开 foliate-view 提取元数据 → 可能短暂闪烁；可在离屏容器中处理