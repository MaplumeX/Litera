# Agent dir protocol (child 1 of decouple-agent-config)

## Goal

让 sidecar 从 Rust 传入的独立配置目录读取 provider/auth/models,不再硬编码 `~/.pi/agent`。本任务是基础设施层,不涉及 UI;验证方式为手动放置配置文件后跑 sidecar。

## Parent

`08-12-decouple-agent-config`。本 child 负责 R1、R2、R4(隔离),并定义 child 2 将依赖的协议与目录契约。

## Requirements

### R1 独立配置目录
- sidecar 的 agent 配置目录由 Rust 通过 `configure` 命令传入,路径指向 `<app_data_dir>/agent/`。
- sidecar 不再读取 `process.env.HOME` 或 `~/.pi/agent`;移除 `makeResourceLoader()` 中的 `agentDir` 硬编码。
- 目录在 sidecar 首次使用前由 Rust 确保存在(Rust 在发送 `configure` 前创建目录)。
- `<app_data_dir>/agent/` 与现有 `<app_data_dir>/sessions/` 同级。

### R2 配置目录传递(协议命令)
- 新增 sidecar 协议命令 `configure`,字段:`requestId`、`agentDir`(string,绝对路径)。
- Rust 在 sidecar 启动后、发任何 `open_book` 之前发送一次 `configure`(幂等;重复发送也安全,sidecar 以最后一次为准)。
- sidecar 收到 `configure` 后,存储 agentDir,后续所有 `DefaultResourceLoader` 与 `SessionManager` 相关构造使用该目录。
- sidecar 在未收到 `configure` 前若收到 `open_book`,应以 error 事件拒绝(而非用回退目录),保证契约显式。
- 协议命令解码需校验 `agentDir` 为非空绝对路径,长度上限沿用 `MAX_ID_LENGTH` 或更宽松的路径上限(见 design)。

### R4 隔离
- 全程不读取、不写入 `~/.pi/agent`。
- `systemPromptOverride`、`noExtensions/noSkills/noPromptTemplates/noThemes/noContextFiles` 等阅读助手设定保持不变。
- 现有 sessions 目录布局与传递方式不变(`open_book` 仍带 `sessionsDir`)。

## Constraints

- `sidecar/protocol.ts` 与 `src-tauri/src/sidecar_protocol.rs` 必须同步新增 `configure`,编解码一致。
- `AGENT_PROTOCOL_VERSION` 仍为 1(新增命令属向后兼容;旧 sidecar 不认识 `configure` 会报 error,Rust 需容忍此情况以支持滚动升级窗口——见 design 决策)。
- 不改 pi-coding-agent SDK 本身,只改调用方式。
- sidecar 打包产物需重新构建(`sidecar/scripts/build.mjs`)。

## Acceptance Criteria

- [ ] `configure` 命令在 `protocol.ts` 与 `sidecar_protocol.rs` 中均可编解码,新增单元测试通过。
- [ ] Rust 在 sidecar `ready` 后、首个 `open_book` 前发送 `configure`,携带 `<app_data_dir>/agent/` 路径。
- [ ] sidecar 收到 `configure` 后将 agentDir 用于 `DefaultResourceLoader`;移除 `${process.env.HOME}/.pi/agent` 硬编码,grep 确认无残留。
- [ ] 在 `<app_data_dir>/agent/` 手动放置有效 `auth.json` + `settings.json` 后,打开书发送 prompt 能正常流式返回。
- [ ] 删除/重命名 `~/.pi/agent` 后,Litera 仍能正常工作(不读取本机 pi 配置)。
- [ ] sidecar 未收到 `configure` 前收到 `open_book`,返回 error 事件而非使用回退目录。
- [ ] 现有 sidecar 协议测试与 Rust 协议测试全部通过;新增 configure 编解码测试通过。
- [ ] `<app_data_dir>/agent/` 不存在时 Rust 自动创建空目录,sidecar 不报启动错误。

## Out of Scope

- 配置 UI(属 child 2)。
- OAuth provider 支持(父任务 out of scope)。
- `models.json` 自定义(内置 catalog 足够)。

## Notes

- pi 有内置 provider catalog(`builtinProviderCatalog.builtinProviders()`),即使 `models.json` 不存在也能列出 provider;`models.json` 用于覆盖/扩展。本任务不依赖此细节,但 child 2 的 UI provider 列表来源依赖此事实。
- `ModelConfig.load` 在 `models.json` 不存在时返回空 Map(不报错),所以空目录安全。