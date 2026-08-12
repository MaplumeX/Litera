# Technical Design

## Dependency

本子任务在 `fix-library-persistence-safety` 之后实施，复用其 `LibraryStore`、严格错误和受控 EPUB 读取接口。它为 `fix-sidecar-state-protocol` 提供 Tauri shell transport 与 external binary。

## Self-contained Sidecar Build

采用 Tauri 官方 Node sidecar 路径：

1. sidecar TypeScript 先编译/打包为发布入口。
2. 使用 `@yao-pkg/pkg` 生成当前 target 的 self-contained Node executable。
3. 构建脚本读取 `TAURI_TARGET_TRIPLE`；未提供时仅在本机开发使用 `rustc --print host-tuple`，禁止把 host triple 误用于显式交叉编译。
4. 输出到 `src-tauri/binaries/litera-sidecar-$TARGET_TRIPLE[.exe]`。
5. `tauri.conf.json > bundle.externalBin` 登记 `binaries/litera-sidecar`。
6. Rust 注册 `tauri-plugin-shell`，只从 Rust 侧调用 `app.shell().sidecar("litera-sidecar")`；WebView 不获得 shell spawn 权限。

生成的二进制不提交 Git，由标准 `predev`/`prebuild` 脚本生成。构建缺依赖、target 不支持或产物冒烟失败时立即失败，不能退回系统 `node`。

## Packaging Spike and Fallback

sidecar 依赖包含 ESM、FTS5 WASM 和少量平台原生资产。实现先做最小发布 spike：

- 生成 executable。
- 在清空 Node PATH 的环境中启动。
- 发送 `ping`，等待 `ready/pong`。
- 加载 FTS5 WASM 并完成一个最小内存查询。

首选 `@yao-pkg/pkg`，因为 Tauri 官方 Node sidecar 指南采用该方案。若它无法可靠包含当前依赖图，允许回退为：固定版本官方 Node runtime + 编译后的 JS/生产依赖作为 Tauri resources。回退方案也必须不依赖系统 Node、使用 target-aware 构建，并通过同一冒烟测试；不能回到 `CARGO_MANIFEST_DIR`。

## Build Script Contract

根级脚本统一负责安装检查、sidecar build、产物命名和 smoke：

```text
npm run build:sidecar   # 生成 target executable
npm run smoke:sidecar   # 独立 stdio ready/ping/FTS 冒烟
npm run dev             # predev 确保 dev sidecar 可用，再启动 Vite
npm run build           # prebuild 先构建/验证 sidecar，再构建前端
```

fresh clone 只需要标准根级依赖安装和构建入口，不要求人工进入 `sidecar/`。交叉目标通过 CI matrix 在目标 OS/arch 原生生成，避免把单机产物冒充跨平台产物。

## Runtime Transport

- Tauri shell plugin 返回 child handle 和异步 `CommandEvent` receiver。
- Rust 把 stdout byte chunks 交给 JSONL line framer，stderr 作为诊断日志，terminated/error 转为 transport status。
- stdin write 通过 plugin child handle/内部队列完成，不使用主线程上的 `std::process::ChildStdin::write_all/flush`。
- 本子任务只建立 transport 和最小 ready/ping；完整 supervisor、重启和业务状态重放由后续 protocol 子任务实现。

## Raw EPUB IPC

结构化元数据和二进制内容拆分：

- `import_book`：文件选择、持久化和轻量 `{ bookId, name }` 响应。
- `get_book_open_context`：返回名称、进度和设置，不包含 bytes。
- `read_book_bytes`：只读取已导入 EPUB，返回 `Result<tauri::ipc::Response, AppError>` 的 Raw body。
- `open_book_bytes`：读取并返回 Raw body，同时在成功后通知 sidecar 打开该书；内部复用同一 Library read API。

前端统一使用 `invoke<ArrayBuffer>()`，立即包装为 `Uint8Array`/`File`。`FileData` 不再声明 `number[]`。

旧 `greet`、未被当前产品流使用的 legacy `open_file` 和 `openEpubFile` 删除，避免保留第二套 JSON bytes 与源路径读取接口。该内部 IPC 兼容性破坏与用户允许的本地重置一并在本版本完成。

## Security

- shell plugin 只在 Rust 注册，不向 capabilities 暴露 WebView spawn/execute 权限。
- externalBin 名称固定，运行时不接受来自前端的 executable/path 参数。
- CSP、asset protocol scope 和 dialog 权限保持不变。
- 打包产物不得包含 API key、用户 home 内容或 session 数据。

## Rollback

- externalBin 配置仅在 executable build + smoke 通过后接入。
- Raw IPC 的 Rust/TS/ReaderView 改动在同一提交切换；失败时整体回滚，不保留双协议。
- packaging spike 失败时先验证 resources fallback，未通过前不替换现有开发启动路径。
