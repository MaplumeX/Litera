# Design: Library shelf loop and import-delete UX

## Architecture

书库仍由 Rust `LibraryStore` 持久化、React 渲染。本任务在现有导入/打开/删除链上加字段、分类结果和确认框，不改 sidecar 协议。

```
拖放路径 / 多选对话框
        │
        ▼
import_book / import_paths  ──►  SHA-256 + 路径 bookId
        │
        ├── duplicate     → 不 staging，返回已有 bookId/title
        ├── overwrite     → 只 staging，等确认后再 save_book_metadata
        └── new           → 现有 stage → 抽元数据 → commit

打开书: get_book_open_context(title) + open_book_bytes → 写 lastOpenedAt
删除:   delete_book → trash 书目录 + 删 sessions/<id>/
```

## Boundaries

### Rust（`library.rs`）

`BookRecord` 新增可选字段（`#[serde(default)]`，`schemaVersion` 仍为 1）：

- `lastOpenedAt: Option<String>` — RFC3339
- `contentHash: Option<String>` — EPUB 字节的 SHA-256 hex（64 位小写）

`BookOpenContext` 增加 `title: String`（来自记录）。`name` 仍给 foliate 当文件名，可继续用 `book.epub`。

`ImportBookResult` 改为带状态：

```ts
type ImportStatus = "new" | "overwrite" | "duplicate";
interface ImportBookResult {
  status: ImportStatus;
  bookId: string;
  title: string;       // 已有书的书名，或本次文件名
  importId?: string;   // new / overwrite 才有
  name: string;        // 源文件名，抽元数据用
}
```

新/改命令：

| 命令 | 作用 |
|------|------|
| `import_book` | `blocking_pick_files()`，对每本走同一分类，返回 `ImportBookResult[]`。取消选择仍 `Cancelled`。 |
| `import_paths` | 拖放用。参数 `paths: string[]`。只接受真实 `.epub` 常规文件，拒绝 symlink / 非 epub。 |
| `discard_import` | 用户取消覆盖时删掉该 `importId` 的 staged 文件。 |
| `list_books` | 返回前按 `lastOpenedAt` 倒序，缺失的靠后，再按 `importedAt` 倒序。 |
| `get_book_open_context` | 加 `title`。缺 `contentHash` 时顺带从 `book.epub` 补写（同一把 store 锁）。 |
| `open_book_bytes` | 成功读出并通知 sidecar 后写入 `lastOpenedAt = now`。打开失败不改时间。 |
| `delete_book` | 现有 trash 协议成功后 `remove_dir_all(sessions/<bookId>)`。目录不存在视为成功。 |
| `update_reading_state` | 不负责 `lastOpenedAt`（避免翻页 debounce 误触）。 |

`save_book_metadata` 在 commit 时写入本次 staged 字节的 `contentHash`。覆盖路径不得清空 `lastFraction` / `settings` / `lastOpenedAt`。

分类规则（在 `import_bytes` 里，staging 之前）：

1. 计算路径 `bookId` 与内容 SHA-256。
2. 比对前把库里缺 hash 的书按存储 EPUB 补齐（只在这次导入/打开时，不在启动时全扫）。
3. 若存在**另一本** `contentHash` 相同 → `duplicate`，不 staging。
4. 若路径 `bookId` 已存在 → 按现有协议只写 `.imports/<importId>.epub`，返回 `overwrite`。
5. 否则按现有新书协议 staging，返回 `new`。

同一批多文件：逐本分类。前一本刚 commit 的 hash 对后一本可见（同一把锁外循环也可以，但每本 `import_bytes` 各自持锁即可）。

### React

- `LibraryView`：拖放区、多文件导入循环、覆盖/重复提示、选择模式、shadcn 确认框。
- `BookCard`：进度条；选择模式下勾选，隐藏单本 ✕ 的「打开」行为。
- `App.tsx`：用 context.`title` 填 `currentBook.title`。
- 用 `AlertDialog` 替换 `confirm()`；导入/删除失败用页面内 banner，不用 `alert()`。

拖放走 Tauri `getCurrentWebviewWindow().onDragDropEvent`，把 `paths` 交给 `import_paths`。不要给 WebView 加 `dialog` / `fs` / `opener` 权限。路径只来自 OS 拖放或 Rust 文件框，不接受用户手输路径。

选择模式是 `LibraryView` 本地 state，不进 `library.json`。

## Data flow

### 多文件 / 拖放导入

1. 得到一组路径（对话框或 drop）。
2. `import_book` / `import_paths` 返回结果数组。
3. 对每个 `new` / 已确认的 `overwrite`：`read_import_bytes` → foliate 抽元数据 → `save_book_metadata`。
4. 每个 `overwrite`：先弹确认；否 → `discard_import`。
5. 每个 `duplicate`：banner「《title》已在书库」，带「打开」按钮。
6. 全部结束后 `list_books` 刷新。

### 打开

1. `get_book_open_context`（title + 可能补 hash）。
2. `open_book_bytes` 成功 → 写 `lastOpenedAt`。
3. `App` 把 `title` 写入 `currentBook`。

### 删除

1. 单本或选择模式多本 → 一个 `AlertDialog`。
2. 按 id 依次 `delete_book`。失败的留下并显示错误，已成功的不回滚。

## Compatibility

- 旧 `library.json` 没有新字段：`serde(default)` = `None`。校验：`lastOpenedAt` 若有则必须是 RFC3339；`contentHash` 若有则必须是 64 位 hex。
- 不升 `schemaVersion`。
- 旧书没有 hash：第一次打开或下一次导入比对时补写。在补齐之前，仅路径相同会走覆盖；补齐后内容相同才会去重。这是可接受的一次性窗口。
- `sha2` 已在 `Cargo.lock` 传递依赖里，实现时加为 `src-tauri` 直接依赖。

## Trade-offs

- **路径 ID + 内容指纹，而不是改 bookId**：旧会话目录、trash、contentVersion 都不用迁。代价是同一本书换路径仍可能暂时以两本存在，直到其中一本被打开/再导入补上 hash。
- **打开成功才写 lastOpenedAt**：避免点了打不开的书顶到最前。
- **排序放在 `list_books`**：前端搜索仍是过滤，不自己排序，避免两处不一致。
- **删除会话放在书记录提交之后**：书已经从书架消失后会话目录失败，记 `StorageIo` 并返回错误；书不会滚回来（与现有 trash 提交点一致）。实现时尽力删除；测试覆盖「会话目录存在则被删掉」。
- **覆盖先 staging 再确认**：取消必须 `discard_import`，否则 `.imports` 残留。与现有 pending 协议一致。

## Rollback

- 字段可选，旧客户端读新 JSON 会因 `deny_unknown_fields` 失败。本应用只有一个客户端，可接受；不要写未知字段给旧二进制。
- 行为回滚：去掉新命令/UI 即可；已写入的 `lastOpenedAt` / `contentHash` 可留在 JSON 里。
