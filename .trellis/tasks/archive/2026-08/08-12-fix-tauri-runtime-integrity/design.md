# Technical Design

## Architecture Overview

本任务把当前集中在 `src-tauri/src/lib.rs`、`sidecar/index.ts` 和 `ChatPanel.tsx` 的隐式共享状态拆为三个有明确所有者的边界：

1. **Library service**：Rust 独占书库文件系统事务、路径验证和存储版本。
2. **Sidecar supervisor + protocol state machine**：Rust 独占子进程生命周期和事件快照，Node 独占书籍/会话/prompt 状态转换。
3. **Typed frontend boundary**：React 只消费带关联 ID 和版本的事件/快照，EPUB 内容使用 Raw IPC body。

父任务不直接实现代码，只定义跨子任务不变量、执行顺序和最终集成门禁。

## Global Invariants

- 一个书库变更只有在原子替换成功后才对后续命令可见。
- 任意文件删除/写入目标必须由应用数据根和已验证 ID 派生，不能直接信任前端路径。
- 任一 Agent 流事件必须能唯一归属到 `bookId + sessionId + promptId`；不匹配当前版本的事件被丢弃。
- Tauri 主线程只做参数解码、状态快照和有界队列入队，不执行阻塞文件或管道 I/O。
- sidecar 可执行文件由标准构建命令生成并通过 Tauri `externalBin` 定位；生产运行不读取源码路径。
- 二进制 EPUB 不进入 serde JSON；结构化元数据和 Raw bytes 分离传输。

## Compatibility and Reset

用户允许重置本地数据。新版本在 sidecar 启动前检查存储版本：

1. 当前根目录存在无版本的 `library.json`、`books/` 或 `sessions/` 时，创建 `backup/legacy-<UTC timestamp>/`。
2. 将旧数据重命名到备份目录；任一步失败立即停止初始化并保留原数据。
3. 创建带 `schemaVersion` 的空书库及新会话根。
4. 新实现不解析或迁移旧书库/会话内容。

这样避免复杂迁移，同时让误重置仍可人工恢复。

## Cross-Task Contracts

### Library → IPC

- Library child 提供可测试的 `LibraryStore` 和按 `bookId` 读取 EPUB 的服务方法。
- Packaging/IPC child 在该服务之上拆分轻量元数据命令与 Raw bytes 命令，不重复文件访问逻辑。

### Packaging → Supervisor

- Packaging child 生成 `litera-sidecar-$TARGET_TRIPLE[.exe]` 并登记到 `bundle.externalBin`。
- Protocol child 通过 Tauri shell sidecar API 启动同名二进制，不感知构建机路径。

### Supervisor → Frontend

- Rust 保存最新 `AgentSnapshot { version, generation, status, bookId, sessionId, promptId, error }`。
- Rust 先更新快照、再发带同一版本的事件；React 监听建立后读取快照，并只应用不旧于当前版本且关联 ID 匹配的更新。

## Child Ordering

1. `fix-library-persistence-safety`：先稳定存储服务和命令边界。
2. `fix-sidecar-packaging-ipc`：依赖新的 Library API，完成 Raw IPC、可执行 sidecar 和 Tauri shell 基础接入。
3. `fix-sidecar-state-protocol`：依赖 externalBin/shell transport，完成 supervisor、协议状态机和 React 事件层。
4. 父任务执行全量集成、规格更新、重置/恢复演练和发布冒烟。

## Trade-offs

- 选择 JSON 文件加串行事务，而不是引入数据库；当前书库规模不需要数据库，原子文件足以满足一致性。
- 选择 stdio JSONL，而不是 localhost 服务；保留现有安全边界和部署形态。
- 首选 Tauri 官方 Node sidecar 路径：用 `@yao-pkg/pkg` 产出 self-contained binary，再由 `externalBin` 打包。若依赖图中的 WASM/原生资产无法可靠封装，允许回退到“固定 Node runtime + resources”方案，但安装版仍必须 self-contained。
- 选择快照加版本化事件，而不是引入 Redux/Zustand；现有组件规模仍适合局部 reducer/hook。

## Rollback Shape

- 每个子任务单独提交、单独通过测试后再进入下一项。
- 存储重置通过 rename 到备份目录实现可恢复回滚。
- sidecar 打包先完成独立 stdin/stdout 冒烟，再替换生产启动路径；失败时回滚该子任务提交，不保留半配置 externalBin。
- Raw IPC 与旧 JSON bytes 不并存；跨层改动在同一子任务内一起切换，避免双协议漂移。
