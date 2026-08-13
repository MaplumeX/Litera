# Associate Litera as an EPUB opener

## Goal

用户在 macOS / Windows / Linux 上双击 `.epub`，或通过「打开方式」选 Litera 时，应用接收该文件、按现有书库规则导入，并打开最后一本成功处理的书。

## Background

Litera 已经是 EPUB-only 阅读器，但只支持应用内导入和窗口拖放。打包配置没有 `fileAssociations`，运行时也不接收系统打开事件。`LibraryView` 在阅读器视图会卸载，所以系统打开必须由仍挂载的根层处理。

## Confirmed facts

- `src-tauri/tauri.conf.json` 的 `bundle` 只有 icon / sidecar，`targets` 为 `all`。
- `src-tauri/src/lib.rs` 没有 `RunEvent::Opened`、启动参数或单实例转发。
- 文件选择器：`import_book`（`library.rs:1624`），过滤器 `["epub"]`。
- 拖放：`LibraryView.handleDroppedPaths` → `import_paths`（`LibraryView.tsx:206`，`library.rs:1663`）。
- `import_paths` 只接受绝对路径上的常规 `.epub`，拒绝符号链接和非 EPUB（`library.rs:1345`）。
- 导入分类：`new` / `duplicate`（同 `contentHash`）/ `overwrite`（同 source-path `bookId`，需确认后提交）。
- 打开已入库的书：`get_book_open_context` + `open_book_bytes`（`App.tsx:234`），切换前会 `flushReadingState`。
- Tauri 2：`bundle.fileAssociations` 负责安装时注册。`RunEvent::Opened` 只在 macOS / iOS / Android 上有。Windows / Linux 靠 argv；已运行时要靠 `tauri-plugin-single-instance` 把参数转给现有窗口。
- EPUB 是公共格式（MIME `application/epub+zip`），不应注册成 Litera 私有类型。

## Requirements

- R1. 安装后的 Litera 出现在系统「用此应用打开 `.epub`」列表中，声明扩展名 `epub` 与 MIME `application/epub+zip`。角色为 Viewer，rank 为 Default，不导出私有 UTI，不静默改系统默认应用。
- R2. 从系统打开 `.epub` 时，Litera 能拿到绝对路径：冷启动与应用已运行两种情况都要覆盖 macOS、Windows、Linux。
- R3. 收到的路径走现有 `import_paths` 校验：只接受常规 `.epub` 文件，拒绝符号链接和非 EPUB。
- R4. 每个有效路径按现有导入分类处理：
  - `new`：自动提交入库。
  - `duplicate`：不新增副本。
  - `overwrite`：弹出与拖放相同的覆盖确认；确认后提交，取消则不改该书、继续处理后续文件。
- R5. 一批路径全部处理完后，打开最后一本成功入库或命中书库的书。正在读另一本时，先按现有切换路径保存进度再打开。没有任何一本成功时留在当前视图。
- R6. Windows / Linux 已运行时，第二次启动把路径转给现有窗口并聚焦，不新开第二个 Litera 进程。macOS 已运行时走系统 Open 事件到同一进程。三个桌面平台都启用单实例。
- R7. 文件不可读、校验失败、导入失败对用户可见，不静默丢弃；失败项不影响同批后续文件。

## Acceptance Criteria

- [ ] AC1. 打包配置声明 `.epub` / `application/epub+zip`，role=`Viewer`，rank=`Default`，无 `exportedType`（R1）。
- [ ] AC2. 冷启动：用 Litera 打开一个尚未入库的 `.epub`，应用启动后进入该书阅读器，书库出现这条记录（R2、R4、R5）。
- [ ] AC3. 热启动：Litera 已运行时再用它打开一个 `.epub`，现有窗口处理该文件并聚焦，不出现第二个进程（R2、R6）。
- [ ] AC4. 非 `.epub`、符号链接、不可读文件不入库，并有可见错误（R3、R7）。
- [ ] AC5. 内容已在书库：直接打开已有记录，不新增副本（R4、R5）。
- [ ] AC6. 同路径但内容变化：弹出与拖放相同的覆盖确认；确认后打开新版本并保留进度/设置/会话；取消后该书与当前阅读不变，同批后续文件继续处理（R4、R5）。
- [ ] AC7. 正在阅读时打开另一本：当前书进度先保存，再切到新打开的书（R5）。
- [ ] AC8. 一次打开多个 `.epub`：按顺序全部导入，打开最后一本成功的书；中途失败只报告该项（R5、R7）。
- [ ] AC9. macOS / Windows / Linux 打包都带上该文件关联；Windows / Linux 热启动走单实例转发（R1、R6）。

## Out of scope

- 其他格式（PDF、mobi、txt 等）。
- 移动端（Android / iOS）文件关联。
- 静默把系统默认 EPUB 应用改成 Litera。
- 改变拖放 / 文件选择器的「只导入不自动打开」行为。
- Snap / Flatpak 的 DBus 单实例清单。
- 多窗口、多 profile 并行运行。

## Decisions

- Q1 = 导入并立即打开阅读器。不采用只入库，也不采用临时打开不入库。
- Q2 = macOS + Windows + Linux。Windows / Linux 用启动参数 + 单实例转发；应用变为单实例。
- Q3 = 一次打开多本时全部按顺序导入，打开最后一本成功的书。
- 关联声明用 Viewer + Default，不导出私有类型，不强制改默认应用。

## Technical notes

- 系统打开入口复用 `import_paths` / `save_book_metadata` / `open_book_bytes`，不新开一套读写。
- `LibraryView` 在阅读器视图会卸载；系统打开与覆盖确认必须挂在 `App` 仍存活的一层。
- macOS 本机可验证冷/热启动。Windows / Linux 的系统「打开方式」用路径解析 + 单实例回调的自动化测试覆盖，并留下本机手动清单。
