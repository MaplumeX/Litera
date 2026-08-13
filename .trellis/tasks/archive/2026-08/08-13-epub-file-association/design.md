# Design: Associate Litera as an EPUB opener

## Architecture

三层，不新开存储模型：

```
OS (Finder / Explorer / 文件管理器)
  │  双击 / 打开方式
  ▼
Tauri 主进程
  │  fileAssociations 注册
  │  macOS: RunEvent::Opened
  │  Win/Linux: argv + single-instance
  │  规范化成绝对路径，入队，发信号
  ▼
App（始终挂载）
  │  take 队列 → import_paths → 现有分类
  │  覆盖确认（阅读器页也要能弹）
  ▼
get_book_open_context + open_book_bytes
```

系统打开只是第三条「拿到绝对路径」的入口。导入、覆盖、打开继续走 `import_paths` / `save_book_metadata` / `open_book_bytes`。

## Boundaries

### 1. 打包注册

`src-tauri/tauri.conf.json`：

```json
"fileAssociations": [
  {
    "ext": ["epub"],
    "mimeType": "application/epub+zip",
    "name": "EPUB",
    "description": "EPUB Book",
    "role": "Viewer",
    "rank": "Default"
  }
]
```

不设 `exportedType`。可选再加 `contentTypes: ["org.idpf.epub-container"]`，仅当实现时确认当前 Tauri 版本会把它写成 `LSItemContentTypes` 而不会导出私有类型。

### 2. Rust：路径队列

新模块 `src-tauri/src/open_paths.rs`（跟现有 `library.rs` 分模块，不把逻辑堆回 `lib.rs`）。

职责：

- 把 `file://` URL、argv、单实例 `args` 收成绝对路径。
- 相对路径用提供的 `cwd` 拼。
- 丢掉 argv[0]、以 `-` 开头的 flag、非 `.epub`（大小写不敏感）。
- 入队前做路径规范化；**不**在这里做 symlink / regular-file 拒绝（交给已有 `import_paths`，以便前端拿到同样的 `InvalidInput`）。
- `take_pending_open_paths` **drain** 队列后返回 `Vec<String>`。
- 每次入队后 `emit("open-paths-available", ())`。前端只把事件当唤醒信号，以 take 结果为准，避免「既 emit 路径又留在队列」的双处理。

状态：`OpenedPaths(Mutex<Vec<PathBuf>>)`，在 `setup` 里 `manage`。

`lib.rs` 接线：

1. **最先**注册 `tauri-plugin-single-instance`。回调：从 `args` + `cwd` 解析路径 → 入队 → emit → `main` 窗口 `set_focus()`。
2. `setup` 末尾：解析当前进程 `std::env::args()`（同样规则）并入队。macOS 冷启动主要靠随后的 `Opened`，这里入队是 Win/Linux 冷启动；重复路径在前端同一批 drain 里去重即可。
3. `build(context).run(|app, event|)`：在 macOS 上处理 `RunEvent::Opened`，URL → 本地路径 → 入队 → emit。

### 3. Frontend：根层导入并打开

`App.tsx` 在 library / reader 之间切换时会卸载 `LibraryView`。系统打开监听必须放在 `App`（或 App 调用的 hook），不能只放在 `LibraryView`。

抽取 `src/lib/use-book-import.ts`（纯流程）+ 薄 React 包装，供两处使用：

| 调用方 | 触发 | 导入后 |
|---|---|---|
| `LibraryView` | 选择器 / 拖放 | 只刷新书库（现有行为，不自动打开） |
| `App` | `open-paths-available` + 启动 take | 打开最后一本成功的书 |

「成功」= `new` 已 `save_book_metadata`，或 `duplicate`，或 `overwrite` 已确认并提交。取消覆盖、校验失败、提交失败都不算成功，但要有可见错误，并继续同批后续文件。

覆盖确认 UI 提到仍挂载的一层（`App` 持有 dialog，或 hook 返回 `confirm` 由 `App` 渲染）。阅读器页打开同路径不同内容时必须能弹确认，不能因为 `LibraryView` 已卸载而丢掉。

`useEffect` 顺序：

1. 注册 `listen("open-paths-available")`，handler 调 `take`。
2. listen resolve 之后立刻 `take` 一次，吃冷启动队列。
3. disposed flag：cleanup 后才 resolve 的 `listen()` 立刻 unlisten（与 `use-agent-bridge` 相同）。

打开走现有 `handleOpenBook`（内部已 `flushReadingState` + latest-serialized）。一批多文件先全部导入，再只调用一次打开（最后成功的 `bookId`）。

拖放仍留在 `LibraryView`，行为不变。

## Data flow

### 冷启动（未运行）

1. 系统启动 Litera 并带上文件。
2. Win/Linux：`setup` 从 argv 入队。macOS：`RunEvent::Opened` 入队。
3. WebView 挂载 → listen → take → `import_paths` 逐个路径。
4. 打开最后一本成功的书。

### 热启动（已运行）

1. macOS：同一进程 `RunEvent::Opened`。Win/Linux：第二进程被单实例拦住，回调入队。
2. emit 信号 → 已挂载的 `App` take。
3. 窗口聚焦。正在阅读则先 flush 再切书。

### 多文件

`["a.epub", "b.epub"]`：先完整处理 a（含可能的覆盖确认），再处理 b，最后 `open_book_bytes(b)`。a 失败则提示 a，仍处理 b。

## Contracts

```rust
#[tauri::command]
fn take_pending_open_paths(state: State<OpenedPaths>) -> Vec<String>
```

- 返回绝对路径字符串；空队列返回 `[]`，不是错误。
- 调用方必须当作一次性领取：第二次 take 不应再看到同一批。

事件：

```ts
listen("open-paths-available", () => { void drainAndImport(); });
```

payload 为空。不要 listen 路径列表。

路径解析（Rust，可单测）：

- `file://` → `Url::to_file_path()`，失败则跳过该 URL。
- 其它 scheme 跳过。
- 普通路径：相对则 `cwd.join`，再 `canonicalize` 失败时仍返回绝对化后的路径，让 `import_paths` 报「不可读」。

## Compatibility

- 单实例是行为变化：不能再开两个 Litera。可接受（Q2）。两个进程本来就会抢 `library.json`。
- 不改 `import_paths` 校验语义。
- 不改拖放 / 选择器的「导入不自动打开」。
- `tauri dev` 一般不注册系统关联。开发验证：`tauri dev` 后用 argv，或打包后 `open -a Litera -- file.epub`。

## Trade-offs

| 选项 | 选择 | 原因 |
|---|---|---|
| emit 路径 vs 只发信号 + drain | 只发信号 + drain | 避免冷启动双处理 |
| 系统打开逻辑放 LibraryView | 放 App | 阅读器页 LibraryView 已卸载 |
| 新命令直接打开文件 | 复用 import_paths | 分类 / 覆盖 / contentHash 已存在 |
| 只做 macOS Opened | 三平台 + 单实例 | Q2 |
| rank Owner | Default + Viewer | 不宣称拥有公共 EPUB 类型 |

## Rollback

1. 去掉 `fileAssociations` 与 single-instance plugin。
2. 恢复 `Builder::run`。
3. 删除 `open_paths.rs` 与 App 侧 listen。
4. 已安装用户可能仍留有系统关联，需重装 / 重置默认应用；代码回滚本身不清理 OS 注册。
