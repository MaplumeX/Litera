# 修复 Tauri 并发、持久化与 Sidecar 问题

## Goal

系统性修复 Litera 桌面端 Tauri 边界中的数据安全、异步并发、跨书状态、事件生命周期、sidecar 发布和大文件 IPC 问题，使书库、阅读进度与 Agent 会话在开发版和安装版中都保持一致、可恢复且可验证。

## Background

当前只读审查确认了以下问题：

- Rust 通过编译机的 `CARGO_MANIFEST_DIR` 和系统 `node` 启动 sidecar，安装包没有自包含 sidecar；证据：`src-tauri/src/lib.rs:43-66`、`src-tauri/tauri.conf.json:29-39`、`.gitignore:11`。
- 新书打开时 sidecar 没有清空旧 `currentSessionId`，可能把新书问题写入旧书会话；证据：`sidecar/index.ts:447-479`。
- `library.json` 的读改写没有共享锁或原子替换，并通过 `unwrap_or(empty)` 吞掉读取/解析错误；证据：`src-tauri/src/lib.rs:365-384,451-532,539-623`。
- `delete_book` 和 `save_book_metadata` 在验证记录前使用前端传入的 `bookId` 构造文件路径；证据：`src-tauri/src/lib.rs:487-516,576-595`。
- 同步 Tauri 命令持有 `std::sync::Mutex` 执行 sidecar 管道写入和 flush，可能冻结 UI 并阻塞 abort/退出；证据：`src-tauri/src/lib.rs:23-31,226-300,715-724`。
- sidecar 对 stdin 消息启动未排序的异步处理，事件缺少 book/request/session 关联；证据：`sidecar/index.ts:520-604`。
- React 逐个异步注册事件监听，存在迟到监听泄漏和一次性 ready 事件丢失；证据：`src/components/ChatPanel.tsx:114-269`、`src/main.tsx:6-10`。
- 阅读进度防抖没有 cancel/flush 生命周期；证据：`src/App.tsx:28-42,68-86,126-133`。
- 重复导入同一路径时，返回的新字节与未更新的存储 EPUB 可能不一致；证据：`src-tauri/src/lib.rs:451-482`、`src/components/LibraryView.tsx:31-47`。
- EPUB 以 JSON `number[]` 穿过 IPC，存在明显的序列化和内存放大；证据：`src-tauri/src/lib.rs:334-350,636-685`。
- Rust 当前没有任何单元测试，严格 Clippy 因一处警告失败。

## Requirements

- **R1 数据完整性与文件安全**：书库所有读改写必须串行一致、原子落盘、显式报告损坏；所有派生文件路径必须限制在应用数据目录内；重复导入、删除和延迟进度更新不得造成元数据与文件不一致。
- **R2 Sidecar 状态隔离**：书籍、会话、prompt 和流事件必须有明确关联；切书、切会话、删除会话、abort 和并发消息必须遵守可测试的状态转换，不得跨书污染。
- **R3 非阻塞与生命周期**：Tauri 主线程不得执行潜在阻塞的文件或管道 I/O；React 监听必须在 StrictMode、卸载和重挂载时无泄漏；sidecar 退出后必须产生可恢复的明确状态。
- **R4 可移植发布**：桌面安装包必须包含当前目标平台可执行的 self-contained sidecar，不能依赖编译机源码路径或用户预装 Node.js。
- **R5 高效 IPC**：EPUB 大字节响应必须使用 Tauri 原始字节响应，不再序列化为 JSON 数组，同时保持现有阅读功能与元数据流程。
- **R6 验证与防回归**：为 Rust 持久化/路径安全、sidecar 状态机/协议、React 事件生命周期和发布 sidecar 增加自动化测试；主前端、sidecar、Rust 测试、Clippy 与目标平台构建全部通过。

## Child Task Map

- `08-12-fix-library-persistence-safety`：R1、阅读状态 flush，以及相应 Rust/前端测试。
- `08-12-fix-sidecar-state-protocol`：R2、R3 中的进程协议/事件/监听/恢复，以及相应 Rust/Node/React 测试。
- `08-12-fix-sidecar-packaging-ipc`：R4、R5，以及可执行 sidecar 和大字节 IPC 验证。
- 父任务负责跨子任务契约一致性、全量回归、规格更新和最终集成验收，不直接承载实现。

## Acceptance Criteria

- [x] 连续快速打开不同书籍、切换/删除会话和终止生成时，任何消息、工具调用、ready/error/session 事件都不会作用于错误的书、会话或 prompt。
- [x] 损坏或不可读的 `library.json` 会返回可见错误且不会被空书库覆盖；并发更新不会丢字段或复活已删除记录。
- [x] 恶意或无效 `bookId` 无法读写或递归删除应用书库目录之外的路径。
- [x] 返回书库和关闭应用前会提交最后的阅读进度/设置，删除与迟到更新不会产生悬空记录。
- [x] 重复导入同一路径的更新策略保持 EPUB、元数据和封面一致。
- [x] sidecar 忙碌、崩溃或退出时 Tauri UI 不冻结，abort 和关闭流程有界完成，用户能看到状态并恢复。
- [x] ChatPanel 在 React StrictMode、折叠/展开和路由卸载后没有重复或泄漏监听，重新挂载能恢复当前 Agent 快照。
- [x] 目标平台安装包在没有系统 Node.js、没有源码目录时能启动 sidecar 并完成 ready/ping 协议冒烟测试。
- [x] 大型 EPUB 通过原始字节 IPC 打开，不再产生 JSON `number[]` 响应，现有导入、元数据解析和阅读行为不回归。
- [x] `npm run build`、sidecar build/test、前端测试、`cargo test --locked`、严格 Clippy 和 Tauri 目标构建全部通过。

## Constraints

- 保持 Tauri v2、React 19、现有 foliate.js 阅读器和 stdio JSONL 协议方向，不引入与修复无关的全局状态框架或 UI 重设计。
- 生产 CSP 必须继续阻止 EPUB 脚本执行；不能为打包或 IPC 放宽 `script-src`。
- sidecar 仅面向 Tauri 桌面目标；移动端支持不在本任务范围。
- 允许启用新的本地存储版本并重置旧数据；旧 `library.json`、`books/` 和 `sessions/` 不要求迁移到新格式。
- 重置采用可恢复方式：先将旧数据移动到带时间戳的备份目录，备份失败则停止初始化，不能直接永久删除。

## Out of Scope

- 更换 Agent 模型、Provider 或提示词策略。
- 重写 EPUB 渲染器、FTS 搜索实现或会话产品界面。
- 与上述缺陷无关的视觉设计调整。
