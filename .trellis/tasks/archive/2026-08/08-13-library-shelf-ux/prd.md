# Library shelf loop and import-delete UX

## Goal

把书库补成日常能用的书架：打开书看得到真书名，卡片看得到进度，默认按最近打开排序；导入/删除按桌面应用的方式工作（拖放、多文件、重复可识别、单本/批量删除确认、删书时处理对话）。

## User Value

用户回到书库时能看出读到哪、最近在读哪本；导入不会静默造出重复书或覆盖进度；删书前能看清后果，对话不会变成孤儿目录。

## Background / Confirmed Facts

- 卡片只展示封面 / 书名 / 作者。`BookRecord.lastFraction` 已持久化（`src/types/library.ts`、`library.rs` `update_reading_state`），卡片不展示。
- `list_books` 按 `library.json` 数组顺序返回（导入顺序）。没有 `lastOpenedAt`。
- 打开书后顶栏标题丢失：`get_book_open_context` 把 `name` 写死为 `"book.epub"`（`src-tauri/src/library.rs:447`），`App.tsx` 把 `currentBook.title` 置空（约 260–269 行）。顶栏用 `currentBook?.title || fileData?.name`，因此显示 `book.epub`。
- 阅读位置恢复已经存在（`initialFraction` + `goToFraction`），本任务不重做恢复逻辑。
- `import_book` 用 `.blocking_pick_file()`，一次一本，仅 `.epub`（`library.rs:1395–1422`）。没有拖放，没有 `pick_files`。
- `bookId` 是源文件路径的 `DefaultHasher`（`book_id_for_source`，`library.rs:1139–1142`）。同一路径再导会覆盖提交；不同路径的同一文件会变成两本。
- 删除：`BookCard` hover ✕ + 浏览器 `confirm()`。`delete_book` 只把 `books/<bookId>/` 挪到 `.trash`，不碰 `sessions/<bookId>/`。
- 前端没有 `AlertDialog`。新确认框走 shadcn，不用 `confirm()` / `alert()`。导入失败目前用 `alert()`（`LibraryView.tsx`）。
- `library.json` `schemaVersion: 1`，`BookRecord` `deny_unknown_fields`。新字段必须 `#[serde(default)]`，不能静默丢书。
- 书库命令保持 async + `spawn_blocking`、可恢复原子写。WebView capability 只有 `core:default`，文件选择仍由 Rust dialog 插件执行。
- 仍只支持 EPUB。

## Key Decisions

- **不改 `bookId` 算法**。另加内容指纹（EPUB 字节 SHA-256）做去重。
- **同一路径再导入**：确认后覆盖文件与书名/作者/封面，保留 `lastFraction`、阅读设置、`lastOpenedAt`、AI 会话。
- **不同路径、内容相同**：不建第二本；提示已在书库，可打开已有记录。
- **没有单独的「继续阅读」入口**。只靠 `lastOpenedAt` 倒序让最近打开的书排在最前。
- **多选包含批量删除**。工具栏「选择」进入选择模式；点封面只勾选不打开；日常不始终显示勾选。
- **删书清理会话**：确认后删除 `sessions/<bookId>/`。批量中某本失败则已成功的保持删除，失败的留在书库并报错。

## Requirements

### R1 打开书显示真书名

- `get_book_open_context` 返回已存的 `title`。
- 打开书后阅读器顶栏显示该书在书库中的书名，不再显示 `book.epub`。

### R2 卡片展示阅读进度

- 有 `lastFraction` 的书在卡片上可见进度（封面底部细条 + 百分比）。
- 从未打开过的书（无 `lastFraction`）不显示 0%。

### R3 最近打开排序

- 成功打开一本书时记录 `lastOpenedAt`。
- `list_books` 默认按 `lastOpenedAt` 倒序；没有打开过的书排在后面，同类按 `importedAt` 倒序。

### R4 拖放与多文件导入

- 书库视图（含空状态）支持把一个或多个 `.epub` 拖进窗口导入。
- 「导入」按钮一次可选多本。逐本走现有 stage → 抽元数据 → commit。
- 非 epub / 用户取消文件选择不报失败。

### R5 重复导入可识别

- 新书写入 `contentHash`。旧书缺指纹时，在下次打开或导入比对时补上，不在启动时全库扫描。
- 同一路径：先确认是否覆盖，再抽元数据并 commit；取消则书库不变，并丢掉本次 staged import。
- 不同路径且指纹已在书库：不 staging、不新建；提示已在书库，提供打开已有那本的入口。
- 内容不同：正常导入。
- 三种结果都要让用户看得见，不能静默覆盖或静默复制。

### R6 删除确认与会话清理

- 删除用应用内确认框。
- 单本：文案含书名，并说明将删除该书的 AI 对话。
- 批量：一次确认，文案含数量，并说明将删除这些书的 AI 对话。
- 确认后对每本书：现有 trash 协议处理书目录；同时删除 `sessions/<bookId>/`。
- 取消不改任何东西。

### R7 书库选择模式

- 工具栏「选择」进入选择模式；卡片出现勾选。
- 选择模式下点击封面是勾选/取消，不是打开书。
- 工具栏显示已选数量、「删除」「取消」。取消或删完后退出选择模式。
- 未进入选择模式时，单本删除入口仍可用。

## Acceptance Criteria

- [ ] 从书库打开书后，阅读器顶栏显示该书在书库中的书名，而不是 `book.epub`。
- [ ] 读过的书在卡片上能看到进度；没打开过的书没有假的 0%。
- [ ] 书库默认按最近打开排序；重开应用后顺序仍在。没有「继续阅读」入口。
- [ ] 能拖入一个或多个 `.epub` 导入成功；导入按钮能一次选多本。
- [ ] 同一路径再导入会先确认覆盖，确认后进度和会话还在；取消则书库不变。
- [ ] 不同路径导入已有相同内容的书时，不产生第二本，并提示已在书库、可打开已有记录。
- [ ] 单本删除需确认；确认后该书从书库消失，且 `sessions/<bookId>/` 被删除。
- [ ] 工具栏「选择」进入选择模式；点封面只勾选不打开；可一次删除多本；确认后选中的书及其会话目录消失，取消则一本不动。
- [ ] 现有阅读恢复、AI 对话、主题/字体不受损。

## Out of Scope

- 单独的「继续阅读」入口 / 横幅
- 标签 / 分类 / 自定义书架
- 元数据编辑（改书名/作者/换封面）
- 书库备份 / 导出
- EPUB 以外的格式
- 书内搜索、书签、进度条拖拽、TTS
- 跨平台 sidecar 打包
- 改 `bookId` 生成算法 / 把身份改成内容 hash
- 批量操作除删除以外的动作（导出、改标签等）
