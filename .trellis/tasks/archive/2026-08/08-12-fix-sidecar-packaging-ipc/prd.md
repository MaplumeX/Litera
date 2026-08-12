# 完善 Sidecar 发布打包与 IPC 性能

## Goal

让 Litera 的桌面安装包在没有源码目录和系统 Node.js 的机器上可靠启动 Agent sidecar，并让大型 EPUB 通过原始字节 IPC 高效进入阅读器。

## Requirements

- **PKG-1**：sidecar 构建必须生成当前 Tauri target triple 对应的 self-contained 可执行文件，并由 `bundle.externalBin` 纳入安装包。
- **PKG-2**：运行时通过 Tauri sidecar 机制定位可执行文件，移除 `CARGO_MANIFEST_DIR`、源码相对路径和 `Command::new("node")` 依赖。
- **PKG-3**：根级开发/发布脚本必须自动构建 sidecar；fresh clone 不依赖手工生成或被忽略的 `sidecar/dist`。
- **PKG-4**：打包流程必须包含 sidecar 所需的 JavaScript 依赖、WASM/原生资产或将其编译进可执行文件，并对不支持的 target 明确失败。
- **PKG-5**：开发模式继续支持快速迭代，生产模式使用与安装包一致的 sidecar 协议和启动路径。
- **IPC-1**：导入/打开 EPUB 的大字节载荷使用 Tauri 原始字节响应；元数据、bookId、名称、进度和设置使用独立的轻量结构化响应或等价契约。
- **IPC-2**：前端以 `ArrayBuffer/Uint8Array` 接收 EPUB，不再构造 JSON `number[]`，foliate.js 的 File 输入行为保持一致。
- **IPC-3**：旧的 `open_file` 兼容入口若保留，也必须使用相同的原始字节路径；不能留下第二套低效实现。

## Acceptance Criteria

- [ ] fresh clone 执行标准构建命令会自动生成 target-triple sidecar，不需要手工进入 `sidecar/`。
- [ ] Tauri 配置包含 external binary，安装版在临时清空 `PATH` 中 Node 项后仍可完成 sidecar ready/ping。
- [ ] sidecar 可执行文件能加载 FTS5 WASM 和 Agent 依赖，stdin/stdout JSONL 冒烟测试通过。
- [ ] 不存在编译机绝对源码路径作为生产 sidecar 定位依据。
- [ ] 打开大型 EPUB 时 Rust 返回 Raw IPC body，前端接收二进制缓冲区，书籍渲染与元数据提取正常。
- [ ] 对原始字节命令、元数据契约和发布 sidecar 产物命名增加自动化检查。
- [ ] 当前主机目标的 Tauri 构建通过；跨平台命名与 CI 构建矩阵有明确配置或验证脚本。

## Constraints

- 遵循 Tauri v2 `bundle.externalBin` 与 target-triple 命名规则。
- 安装包不能要求终端用户安装 Node.js。
- 不把 API 密钥或用户会话数据打进 sidecar 二进制。
- 新安装包允许使用新的本地存储/会话协议，不要求读取旧版本数据。

## Out of Scope

- 移动端 sidecar。
- 将 Node Agent/FTS 全量重写为 Rust。
- 安装包体积优化之外的发布系统改造。
