# Implementation Plan: Windows EPUB Thumbnail Provider + Cover Compression

## Ordered Checklist

### Phase B: Cover Compression（先做，独立可验证）

- [ ] **B1. 添加 `image` 依赖到 `src-tauri/Cargo.toml`**
  - `image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }`
  - 验证：`cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **B2. 实现 `compress_cover` 函数 in `src-tauri/src/library.rs`**
  - 长边上限 512px，JPEG q85
  - 解码失败时 fallback 返回原始 bytes（不阻断导入）
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml library`

- [ ] **B3. 修改 `save_book_metadata`：压缩 + cover.jpg**
  - `cover_path` 从 `cover.png` 改为 `cover.jpg`
  - 在 cover_bytes 验证后调用 `compress_cover`
  - 旧书籍 `cover.png` 不迁移（向后兼容）
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **B4. 新增 Rust 单元测试：compress_cover**
  - 测试小图片不放大
  - 测试大图片缩放到 512
  - 测试无效 bytes fallback
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml compress_cover`

- [ ] **B5. 验证前端测试不受影响**
  - `npm test -- --run`
  - `npx tsc --noEmit`

### Phase A: Windows Thumbnail DLL（后做，独立可验证）

- [ ] **A1. 创建 `src-tauri/windows-thumbnail/` crate 骨架**
  - `Cargo.toml`（cdylib, 独立 workspace, 依赖）
  - `src/mod.rs`
  - 验证：`cd src-tauri/windows-thumbnail && cargo check`（需 Windows target）

- [ ] **A2. 实现 `extraction.rs`：EPUB 封面提取**
  - 4-pass 提取逻辑（文件名 → OPF properties → OPF meta cover → manifest 首图 → 最大图片）
  - `cached_thumbnail_for_path`：partial MD5 + 缓存读写
  - `create_thumbnail_with_overlay`：缩放 + overlay
  - 验证：`cargo test --manifest-path src-tauri/windows-thumbnail/Cargo.toml`

- [ ] **A3. 实现 `com_provider.rs`：COM 接口 + DLL 导出**
  - `ThumbnailProvider`（IThumbnailProvider + IInitializeWithItem）
  - `ThumbnailProviderFactory`（IClassFactory）
  - DLL 导出（DllMain, DllGetClassObject, DllCanUnloadNow, DllRegisterServer, DllUnregisterServer）
  - 文件关联检查（AssocQueryStringW）
  - 验证：`cargo build --release --manifest-path src-tauri/windows-thumbnail/Cargo.toml`（Windows）

- [ ] **A4. NSIS 安装钩子**
  - 创建 `src-tauri/windows/hooks.nsh`（NSIS_HOOK_POSTINSTALL + NSIS_HOOK_PREUNINSTALL）
  - 修改 `tauri.conf.json`：`bundle.resources` + `nsis.installerHooks`
  - 验证：`npm run tauri build`（Windows，检查 DLL 被打包 + 注册）

- [ ] **A5. CI release workflow 更新**
  - Windows matrix 增加 DLL 构建步骤（在 tauri-action 之前）
  - 验证：CI run（或本地 dry-run 检查脚本）

### Phase C: 集成验证

- [ ] **C1. 全量测试**
  - `npm test -- --run`
  - `npx tsc --noEmit`
  - `npx vite build`
  - `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **C2. 非 Windows 编译验证**
  - 确认 `windows-thumbnail/` 不影响主 workspace
  - `cargo check --manifest-path src-tauri/Cargo.toml`（当前平台）

- [ ] **C3. Spec 更新**
  - 更新 `.trellis/spec/backend/` 相关 spec（封面存储格式 PNG→JPEG，新增 thumbnail DLL）

## Validation Commands

```bash
# Frontend
npm test -- --run
npx tsc --noEmit
npx vite build

# Backend (all platforms)
cargo test --manifest-path src-tauri/Cargo.toml

# Thumbnail DLL (Windows only)
cd src-tauri/windows-thumbnail && cargo build --release
```

## Risky Files / Rollback Points

| 文件 | 风险 | 回滚策略 |
|------|------|----------|
| `src-tauri/src/library.rs` | cover.jpg 改动影响导入流程 | 保留 cover.png fallback 逻辑 |
| `src-tauri/Cargo.toml` | image 依赖可能影响编译 | 独立 feature flag 控制 |
| `src-tauri/tauri.conf.json` | bundle.resources 路径错误会导致打包失败 | 路径验证 |
| `.github/workflows/release.yml` | DLL 构建步骤顺序错误 | 本地验证构建顺序 |

## Review Gates

- **B 阶段完成后**：确认 cover 压缩不影响现有导入，再进入 A 阶段
- **A 阶段完成后**：在 Windows 机器上手动验证缩略图显示
- **C 阶段**：全量测试通过后才提交

## Notes

- A 阶段（DLL）无法在当前 Linux 环境编译验证，只能做代码审查。实际编译和测试需在 Windows 环境进行（CI 或手动）。
- B 阶段（cover 压缩）可在当前环境完整开发和测试。
- 建议先完成 B 阶段并提交，再开发 A 阶段。