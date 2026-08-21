# Windows EPUB Thumbnail Provider + Cover Compression

## Goal

让 Windows 资源管理器在 Litera 被设为 `.epub` 默认应用时，直接显示书籍封面作为文件缩略图；同时在导入时优化封面图（缩放重编码），降低磁盘和内存占用。参考 readest 的 `windows-thumbnail` 扩展实现。

## Background

### 现状（代码库证据）
- **封面提取链路已存在**：前端 `src/lib/book-utils.ts` 用 foliate.js `book.getCover?.()` 提取封面 → IPC `save_book_metadata` → Rust `src-tauri/src/library.rs:535` 写入 `<app_data_dir>/books/<book_id>/cover.png`。
- **封面不做缩放**：`MAX_COVER_BYTES = 20MB`（`library.rs:25`），只做大小上限检查，存原始 bytes 为 PNG。
- **AppData 路径**：`src-tauri/src/lib.rs:40` 用 `app.path().app_data_dir()`，Tauri identifier = `com.maplume.litera`，Windows 上为 `C:\Users\<user>\AppData\Roaming\com.maplume.litera`。书籍目录 = `<root>/books/<book_id>/cover.png`。
- **已有文件关联**：`tauri.conf.json` 配置了 `fileAssociations: epub`，bundle targets = all，Windows 用 NSIS 安装器。
- **BookCard 已用封面**：`src/components/BookCard.tsx:34` 用 `convertFileSrc(book.coverPath)` 显示封面。
- **只支持 EPUB**（不像 readest 还支持 MOBI/FB2/CBZ 等），本项目定位是 EPUB reader。

### readest 参考实现
- 独立 Rust crate `windows_thumbnail`（`cdylib`），实现 `IThumbnailProvider` + `IInitializeWithItem` COM 接口。
- 完全独立的封面提取（自己解 ZIP + 读 OPF），不依赖 app runtime。
- 检查 `AssocQueryStringW` 确认 readest 是默认应用，否则返回 `S_FALSE`。
- `DisableProcessIsolation = 1`（在 Explorer 进程内运行）。
- 缩略图缓存：`ProjectDirs` cache dir，用 partial MD5 做缓存 key。
- 右下角叠加 app icon overlay。
- NSIS 安装器自动 `regsvr32` 注册 DLL。

## Requirements

### R1: Windows Shell IThumbnailProvider DLL
- 实现一个 Windows COM DLL（`cdylib`），实现 `IThumbnailProvider` + `IInitializeWithItem`。
- 仅当 Litera 是 `.epub` 默认应用时提供缩略图（`AssocQueryStringW` 检查），否则返回 `S_FALSE`。
- DLL 导出 `DllRegisterServer` / `DllUnregisterServer` / `DllGetClassObject` / `DllCanUnloadNow`。
- 注册到 `HKCR\.epub\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}`。
- `DisableProcessIsolation = 1`，Apartment 线程模型。

### R2: 封面获取策略（独立缩略图缓存 + 现场提取 fallback）
- **缓存**：DLL 维护自己的缩略图缓存目录（`%LOCALAPPDATA%\com.maplume.litera\thumbnails\`），用 epub 文件的 partial content hash 做 key（参照 readest 的 partial MD5 方案）。
- **Fallback**：缓存未命中时，DLL 内部独立解 ZIP + 读 OPF 提取 EPUB 封面（参照 readest 的 `extract_epub_cover_bytes` 逻辑），提取后缩放并写入缓存。
- 与 litera 的 `cover.png` 缓存解耦——两者是独立的收益点（thumbnail 缓存服务 Explorer，cover.png 服务书库视图）。

### R3: 封面压缩优化（导入时）
- 在 EPUB 导入流程中，将封面图缩放重编码为小尺寸（长边上限参照书架网格尺寸），输出 JPEG/PNG，目标 ~30–60KB。
- 修改 `src/lib/book-utils.ts` 的 `extractEpubMetadata` 或 `src-tauri/src/library.rs` 的 `save_book_metadata`（设计阶段确定具体位置）。
- 保持 `MAX_COVER_BYTES` 上限作为安全网。

### R4: 安装器集成
- NSIS 安装器在安装时自动注册 DLL（`regsvr32 /s`），卸载时注销。
- DLL 需被打包进安装产物。

### R5: 只支持 Windows
- 非 Windows 平台不编译此 crate（`cfg(windows)`）。
- macOS/Linux 不受影响。

## Acceptance Criteria

- [ ] AC1: 在 Windows 上将 Litera 设为 `.epub` 默认应用后，资源管理器中 `.epub` 文件显示书籍封面缩略图。
- [ ] AC2: 取消默认应用关联后，缩略图回退到默认图标（不接管）。
- [ ] AC3: DLL 维护独立缩略图缓存（partial content hash key）；缓存命中时直接返回，未命中时现场提取 EPUB 封面并写入缓存。
- [ ] AC4: 导入新书后，存储的 cover 文件长边 ≤ 设计尺寸（如 512px），文件大小显著低于原图。
- [ ] AC5: NSIS 安装后无需手动 `regsvr32`，重启 Explorer 即可见缩略图。
- [ ] AC6: 非 Windows 平台编译和运行不受影响。
- [ ] AC7: 现有测试全部通过（`npm test`、`cargo test`）。

## Out of Scope

- macOS QuickLook / Linux thumbnailer（仅 Windows）。
- MOBI/AZW/FB2/CBZ 等非 EPUB 格式的缩略图支持。
- 系统级 thumbnail 缓存清理工具。

## Open Questions

（无 blocking 问题。以下为设计中将给出的推荐，可在 final review 时调整。）

- **Thumbnail overlay**：推荐参照 readest 在缩略图右下角叠加小的 Litera icon（视觉品牌标识）。如不想要可在 review 时去除。
- **封面压缩目标尺寸**：推荐长边上限 512px，输出 JPEG（质量 85），目标 ~30–60KB。具体在设计阶段根据 BookCard 渲染尺寸确定。
- **CLSID**：为 Litera 生成新的固定 CLSID（不复用 readest 的）。

## Notes

- 复杂任务，需要 design.md + implement.md。
- 涉及 Windows COM / Rust / 前端 TS / NSIS 四个技术域。