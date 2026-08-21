# Design: Windows EPUB Thumbnail Provider + Cover Compression

## Architecture Overview

两个独立但相关的交付物：

```
┌─ Deliverable A: Windows Thumbnail DLL ──────────────────────────────┐
│  src-tauri/windows-thumbnail/          (独立 Rust crate, cdylib)    │
│  ├── extraction.rs   EPUB 封面提取 (解 ZIP + 读 OPF)                │
│  ├── com_provider.rs IThumbnailProvider COM 实现 + 注册/注销        │
│  └── mod.rs           模块入口                                        │
│  src-tauri/windows/hooks.nsh          NSIS 安装/卸载钩子             │
│  src-tauri/tauri.conf.json            bundle.resources + nsis 配置   │
└──────────────────────────────────────────────────────────────────────┘

┌─ Deliverable B: Cover Compression ──────────────────────────────────┐
│  src-tauri/src/library.rs   save_book_metadata 中压缩封面           │
│  (Rust 侧用 image crate 做缩放重编码)                                │
└──────────────────────────────────────────────────────────────────────┘
```

两个交付物完全解耦：DLL 不依赖 litera 运行时，cover 压缩不影响 DLL。

---

## Deliverable A: Windows Thumbnail DLL

### Crate 位置与结构

新建 `src-tauri/windows-thumbnail/`，作为独立 Cargo crate（有自己的 `[workspace]` 声明，避免污染主 Cargo workspace 的依赖树）。

```
src-tauri/windows-thumbnail/
├── Cargo.toml          # cdylib, 独立 workspace
├── src/
│   ├── mod.rs          # 模块入口
│   ├── extraction.rs   # EPUB 封面提取 + 缩略图生成 + 缓存
│   └── com_provider.rs # COM IThumbnailProvider 实现 + DLL 导出 + 注册
└── README.md
```

### 依赖

```toml
[dependencies]
anyhow = "1"
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }
md-5 = "0.10"              # partial content hash (跟随 litera 已用的 sha2 风格)
zip = { version = "6", default-features = false, features = ["deflate"] }
windows = { version = "0.62", features = [
  "Win32_Foundation",
  "Win32_Graphics_Gdi",
  "Win32_System_Com",
  "Win32_System_LibraryLoader",
  "Win32_System_Registry",
  "Win32_UI_Shell",
] }
windows-core = "0.62"
```

不使用 `directories-next`（readest 用的）。改用 `windows` crate 的 `KNOWNFOLDERID::LocalAppData` 直接获取 `%LOCALAPPDATA%`，避免额外依赖。

### CLSID

为 Litera 生成新的固定 CLSID（不复用 readest 的）：

```
{A2A296FA-9317-44A3-A371-6A883CAA1F33}
```

### COM 接口实现

参照 readest `com_provider.rs`：

1. **`ThumbnailProvider` struct**：`#[implement(IThumbnailProvider, IInitializeWithItem)]`
   - `IInitializeWithItem::Initialize` — 接收 `IShellItem`，提取文件路径，检查 Litera 是否是 `.epub` 默认应用（`AssocQueryStringW` + `ASSOCSTR_EXECUTABLE`，检查路径包含 `litera`）
   - `IThumbnailProvider::GetThumbnail(cx, *phbmp, *pdwalpha)` — 调用 `cached_thumbnail_for_path`，将 RGBA 转 BGRA，`CreateDIBSection` 返回 `HBITMAP`

2. **`ThumbnailProviderFactory`**：`#[implement(IClassFactory)]`

3. **DLL 导出**：
   - `DllMain` — 保存 `HMODULE`
   - `DllGetClassObject` — 返回 ClassFactory
   - `DllCanUnloadNow` — 引用计数
   - `DllRegisterServer` — 写注册表（CLSID + InprocServer32 + DisableProcessIsolation=1 + `.epub\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}`）
   - `DllUnregisterServer` — 删注册表

4. **关键设置**：
   - `DisableProcessIsolation = 1`（在 Explorer 进程内运行，减少进程创建开销）
   - `ThreadingModel = Apartment`
   - 仅 `.epub` 扩展名（不像 readest 支持多格式）

### 封面提取逻辑（`extraction.rs`）

参照 readest 的 `extract_epub_cover_bytes`，但简化为仅 EPUB：

1. **Pass 1**：ZIP 中文件名含 "cover"/"front" 的图片，优先级排序后取最佳
2. **Pass 2**：解析 `META-INF/container.xml` → OPF → 找 `properties="cover-image"` 或 `<meta name="cover">` → 定位图片
3. **Pass 3**：manifest 中第一个图片
4. **Pass 4**：ZIP 中最大的图片
5. Fallback：返回错误（Explorer 显示默认图标）

### 缩略图缓存

- **缓存目录**：`%LOCALAPPDATA%\com.maplume.litera\thumbnails\`
  - 通过 `SHGetKnownFolderPath(KNOWNFOLDERID::LocalAppData)` 获取
- **缓存 key**：partial MD5（ext + size + 文件多个位置的 1KB chunk），参照 readest 的 partial hash 策略
- **缓存文件**：`<hash>.png`
- **命中**：直接读缓存返回
- **未命中**：提取封面 → 缩放到 `cx` 尺寸 → 叠加 Litera icon overlay（可选）→ 写缓存 → 返回

### Overlay

参照 readest，在缩略图右下角叠加小的 Litera icon。使用 `src-tauri/icons/128x128.png` 作为 overlay 源（`include_bytes!` 编译进 DLL）。overlay 尺寸 = `cx / 5`，clamp 到 24–48px。

### NSIS 安装器集成

#### 资源打包

`tauri.conf.json` 的 `bundle.resources` 添加 DLL：
```json
"resources": ["windows-thumbnail/target/release/windows_thumbnail.dll"]
```
这样 DLL 会被打包到 `$INSTDIR\` 下。

#### 安装钩子

新建 `src-tauri/windows/hooks.nsh`：

```nsis
!macro NSIS_HOOK_POSTINSTALL
  ; Register thumbnail provider DLL
  ExecWait 'regsvr32 /s "$INSTDIR\windows_thumbnail.dll"' $0
  ${If} $0 != 0
    DetailPrint "Thumbnail provider registration failed (code: $0)"
  ${Else}
    DetailPrint "Thumbnail provider registered"
    ; Refresh Explorer thumbnails
    ExecWait 'ie4uinit.exe -show' $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Unregister thumbnail provider DLL
  ExecWait 'regsvr32 /s /u "$INSTDIR\windows_thumbnail.dll"' $0
!macroend
```

`tauri.conf.json` 配置：
```json
"nsis": {
  "installerHooks": "./windows/hooks.nsh"
}
```

### Cargo workspace 隔离

`windows-thumbnail/Cargo.toml` 包含 `[workspace]` 声明，使其成为独立 workspace，不与 `src-tauri/Cargo.toml` 的 workspace 合并。构建脚本需要先单独编译 DLL：

```bash
cd src-tauri/windows-thumbnail
cargo build --release
```

CI 的 release workflow 需在 `tauri build` 前增加此步骤（仅 Windows matrix）。

---

## Deliverable B: Cover Compression

### 当前流程

```
前端 extractEpubMetadata (foliate.js getCover)
  → coverBytes (原始 bytes, 可能多 MB)
  → IPC save_book_metadata
  → Rust 写入 cover.png (原始 bytes, MAX_COVER_BYTES=20MB 限制)
```

### 设计方案：在 Rust 侧压缩

**为什么选 Rust 侧而不是前端**：
- 前端用 Canvas API 压缩会引入 foliate.js 之外的渲染依赖，且 WebView Canvas 操作是主线程
- Rust 侧用 `image` crate（DLL 也会用），逻辑统一
- `save_book_metadata` 已经接收 `cover_bytes`，在此压缩是最小改动点

### 修改点

**`src-tauri/Cargo.toml`**：添加 `image` 依赖（仅 Windows 需要，但跨平台都用所以不加 cfg）：
```toml
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }
```

**`src-tauri/src/library.rs`** `save_book_metadata`：

在 `cover_bytes` 验证之后、写入 `cover_path` 之前，插入压缩步骤：

```rust
const COVER_MAX_EDGE: u32 = 512;
const COVER_JPEG_QUALITY: u8 = 85;

fn compress_cover(raw: &[u8]) -> AppResult<Vec<u8>> {
    // 解码原始图片
    let img = image::load_from_memory(raw)
        .map_err(|e| AppError::invalid_input(format!("Invalid cover image: {e}")))?;
    
    // 缩放：长边 > COVER_MAX_EDGE 时 thumbnail
    let thumbnail = img.thumbnail(COVER_MAX_EDGE, COVER_MAX_EDGE);
    
    // 重编码为 JPEG（照片类封面更适合 JPEG）
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    thumbnail.write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| AppError::storage_io(format!("Cover re-encode failed: {e}")))?;
    
    Ok(buf)
}
```

**文件扩展名**：压缩后从 PNG 改为 JPEG，`cover_path` 从 `cover.png` 改为 `cover.jpg`。

**兼容性**：
- `BookCard.tsx` 用 `convertFileSrc(book.coverPath)` + `<img>`，不关心扩展名，无需改动
- 已有书籍的 `cover.png` 仍可显示（旧路径存在则用旧路径）
- 新导入书籍写 `cover.jpg`

**MAX_COVER_BYTES 调整**：压缩后通常 < 100KB，可将 `MAX_COVER_BYTES` 保持不变（作为对原始 bytes 的安全网），压缩在验证之后执行。

### 前端测试影响

`book-import.test.ts` 和 `LibraryView.test.ts` mock 了 `extractEpubMetadata` 返回 `coverBytes: null`，不受影响。`BookCard.test.ts` 用 `coverPath: ""`，不受影响。但如果新增 Rust 测试验证压缩逻辑，需要测试图片数据。

---

## 数据流

### Thumbnail DLL 流程

```
Explorer 需要缩略图
  → IInitializeWithItem::Initialize(IShellItem)
  → AssocQueryStringW 检查 litera 是否默认应用
  → IThumbnailProvider::GetThumbnail(cx)
  → cached_thumbnail_for_path(path, ".epub", cx)
    → partial MD5 hash → 查 %LOCALAPPDATA%\com.maplume.litera\thumbnails\<hash>.png
    → 命中: 返回缓存
    → 未命中: extract_epub_cover_bytes → 缩放 → overlay → 写缓存 → 返回
  → RGBA→BGRA → CreateDIBSection → HBITMAP
  → Explorer 显示
```

### Cover Compression 流程

```
导入 EPUB
  → 前端 extractEpubMetadata → coverBytes (原始)
  → IPC save_book_metadata(coverBytes)
  → Rust: compress_cover(coverBytes) → compressed bytes (~30-60KB JPEG)
  → 写 cover.jpg (替代 cover.png)
  → BookCard 用 convertFileSrc 显示
```

---

## 兼容性与迁移

- **旧书籍**：已导入书籍的 `cover.png` 保留，不受影响。新导入写 `cover.jpg`。
- **DLL 未注册**：用户未安装/未设默认应用时，Explorer 用默认图标，无副作用。
- **跨平台**：`windows-thumbnail/` crate 仅在 Windows target 编译。`image` crate 跨平台，cover 压缩对所有平台生效。
- **CI**：非 Windows matrix 不编译 DLL。release workflow Windows matrix 需增加 DLL 构建步骤。

---

## Trade-offs

| 决策 | 选择 | 理由 | 替代方案 |
|------|------|------|----------|
| DLL 位置 | `src-tauri/windows-thumbnail/` 独立 crate | 隔离依赖，不污染主 workspace | 作为主 crate 的 cfg(windows) 模块（会增加编译复杂度） |
| 缓存策略 | 独立缓存 + partial hash | O(1) 查找，readest 验证过 | 复用 litera cover.png（book_id 不可反推，不可行） |
| 压缩位置 | Rust 侧 `save_book_metadata` | 最小改动，逻辑统一 | 前端 Canvas（主线程阻塞） |
| 压缩格式 | JPEG q85 | 照片类封面体积小 | PNG（对封面照片体积大） |
| Cover 尺寸 | 长边 512px | BookCard 渲染 140px×210px，2x DPR = 280px，512px 留余量 | 256px（更小但高 DPR 下模糊） |

---

## 风险

1. **Windows COM 安全性**：DLL 在 Explorer 进程内运行，解析不可信 ZIP/XML。需用 Rust 的安全 API，参照 readest 的内存安全实践。
2. **NSIS 注册权限**：`regsvr32` 写 `HKCR` 可能需要管理员权限。litera 默认 `installMode` 是 currentUser（写 `HKCU`）。需要测试 `regsvr32` 在 currentUser 模式下是否成功，可能需要改用 `HKCU\Software\Classes` 注册。
3. **CI 构建顺序**：DLL 必须在 `tauri build` 之前编译，否则 `bundle.resources` 找不到文件。
4. **cover.jpg 迁移**：旧版本删除书籍时清理 `cover.png`，新版本需同时清理 `cover.jpg`。`delete_book` 已用 `fs::remove_dir_all(book_dir)` 整目录删除，不受影响。