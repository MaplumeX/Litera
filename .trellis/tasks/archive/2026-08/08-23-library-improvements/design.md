# Design: Library management UX

## Architecture

书库仍由 Rust `LibraryStore` 持久化元数据和封面，React 负责浏览、排序、视图和编辑表单。本任务不改 sidecar、不改 EPUB 本体、不 bump `schemaVersion`。

```
list_books ─────────────────────────────┐
                                        ▼
                               LibraryView 本地 state
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                    继续阅读(≤4)    排序后的主列表    搜索过滤
                          │             │
                          └──────┬──────┘
                                 ▼
                    ⋮ / 右键 → 打开 / 详情 / 删除
                                 ▼
                    详情弹窗 ──► update_book_metadata
                                 ▼
                    library.json + cover.jpg（可选）
```

`list_books` 继续按最近打开返回，作为稳定默认序。主列表的五种排序、网格/列表、继续阅读切片都在前端从同一份 `BookRecord[]` 派生。不要给 `list_books` 加 sort 参数。

## Boundaries

### Rust（`library.rs`）

新增命令，不要复用 `save_book_metadata`（它绑定 staged `importId` 和 EPUB 覆盖）：

```rust
async fn update_book_metadata(
    book_id: String,
    title: String,
    author: String,
    cover_bytes: Option<Vec<u8>>,
) -> AppResult<BookRecord>
```

| 参数 | 行为 |
|------|------|
| `title` | 必填，沿用 `validate_text(..., MAX_TITLE_BYTES, false)` |
| `author` | 可空，沿用 `validate_text(..., MAX_AUTHOR_BYTES, true)` |
| `cover_bytes: None` | 不碰 `cover.jpg`，不改 `coverPath` |
| `cover_bytes: Some(bytes)` | 非空；`compress_cover` 后原子写入 `cover.jpg`，更新 `coverPath` |

禁止：改 `bookId`、`filePath`、`contentHash`、`contentVersion`、`lastFraction`、`lastCfi`、`settings`、`lastOpenedAt`、`lastReaderMode`、`lastLayout`、`importedAt`。不删除封面。空 `Some(vec![])` 视为 `InvalidInput`。

写入协议与现有 store 一致：`transaction()` 锁 → 严格读 `library.json` → 可选原子写封面（失败则 restore 旧封面）→ `write_library`（失败则 restore 封面）→ `spawn_blocking`。封面上限仍是 `MAX_COVER_BYTES`。

在 `lib.rs` 注册命令。不改 WebView capability；封面来自详情里的 `<input type="file">`，不走 Rust 文件框。

### React

| 模块 | 职责 |
|------|------|
| `src/lib/library-shelf-prefs.ts` | 读写 `localStorage`：`litera.librarySort`、`litera.libraryView`。非法值回退默认。不要写 `preferences.json`。 |
| `src/lib/library-shelf.ts` | 纯函数：五种排序、继续阅读取前 4 本（有 `lastOpenedAt`）、搜索过滤。 |
| `BookDetailsDialog` | shadcn `Dialog`。书名/作者 `Input`；封面预览 + 选图；只读进度和导入时间。 |
| `BookActionsMenu` | shadcn `dropdown-menu` + `context-menu` 共用三项。 |
| `LibraryView` | 继续阅读横排、排序 `Select`、网格/列表切换、把现有导入/删除/选择模式接进去。 |
| `BookCard` | 保留 hover 删除；非选择模式加 ⋮ 和右键。 |
| 列表行 | 新小组件或 `LibraryView` 内行：缩略图、书名、作者、进度、最近打开、⋮。 |

继续阅读横排：复用封面点击打开；不强制 ⋮，但必须能右键同一菜单。搜索有内容或候选不足 1 本时不渲染该区域。

封面选择：隐藏 `input[type=file] accept="image/*"`。读入 `Uint8Array` 后 `invoke("update_book_metadata", { coverBytes })`。超过 `MAX_COVER_BYTES` 在前端拦截。WebView 不新增 `dialog` / `fs` 权限。

排序与视图控件放在现有书库顶栏（搜索旁），不要再做一条工具栏。

## Data flow

1. 打开书库 → `list_books` → `setBooks`。
2. `recents = takeRecent(books, 4)`；`visible = sort(filter(books, search), sortKey)`。
3. 保存详情 → `update_book_metadata` → 用返回的 `BookRecord` 替换本地数组对应项（或 `refreshBooks`）。
4. 改排序/视图 → 立刻重排/切换，并写入 `localStorage`。

搜索仍只匹配书名、作者（现有行为）。搜索时隐藏继续阅读。

## Compatibility

- 不 bump `library.json` `schemaVersion`，不加 `BookRecord` 字段。
- 旧书无 `lastOpenedAt` / `lastFraction`：不进继续阅读；按进度时排最后。
- 现有 `save_book_metadata` 导入路径不变。
- hover ✕ 删除、选择模式、拖放导入保留。

## Trade-offs

- **前端排序 vs 后端排序**：只有 `LibraryView` 消费列表，五种排序 + 继续阅读切片放前端更简单；Rust 测试里 `list_books` 仍按最近打开，不用为 UI 偏好改命令。
- **新命令 vs 复用 `save_book_metadata`**：后者会提交 staged EPUB 并可能清空封面路径。编辑必须走独立命令。
- **封面用 `<input type="file">` vs Rust dialog**：避免给 WebView 加权限，压缩和校验仍在 Rust。
- **浏览偏好走 `localStorage`**：与 locale / TTS / chrome 字体同一类。写 `preferences.json` 会让旧版本因 `deny_unknown_fields` 把主题重置。

## Rollback

- 新命令失败时 Rust 已 restore 封面和 `library.json`；前端弹窗保持打开并显示错误。
- UI 改坏可只回退 `LibraryView` / 新组件，不影响导入删除协议。
- `localStorage` 损坏则回退默认最近打开 + 网格，不阻塞书库加载。
