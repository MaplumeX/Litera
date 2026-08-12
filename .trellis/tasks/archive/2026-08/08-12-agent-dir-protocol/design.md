# Design — Agent dir protocol (child 1)

## Scope

为 sidecar 协议新增 `configure` 命令,把 Litera 独立的 agent 配置目录路径从 Rust 传给 sidecar,sidecar 用它替换硬编码的 `~/.pi/agent`。本设计只覆盖协议与传递链路,不涉及 UI。

## 现状时序(基线)

```
Rust start_process()
  → 发 Ping(bootstrap)
  → 等 Ready 事件
sidecar main() ready
  → 发 ready 事件
Rust handle_event(Ready)
  → recovering=false → return(首次启动,不发任何命令)
  → recovering=true → 设 recovering=false → 若有 replay_book 则发 OpenBook(恢复启动)
用户打开书
  → notify_book_opened() → 发 OpenBook(path, bookId, sessionsDir)
sidecar open_book
  → BookWorker 加载 → 发 book_loading → book_ready
  → 后续 prompt / session 命令
```

agentDir 目前从未跨进程传递;sidecar 在 `makeResourceLoader()` 内硬编码 `${process.env.HOME}/.pi/agent`,每次 `createSession` / `loadSessionFromDisk` 时构造 `DefaultResourceLoader` 使用该 agentDir。

## 设计决策

### D1 协议命令 `configure`

新增命令类型(协议版本保持 1,向后兼容增量):

```ts
| { protocolVersion: 1; type: "configure"; requestId: string; agentDir: string }
```

```rust
SidecarCommand::Configure {
    request_id: String,
    #[serde(rename = "agentDir")]
    agent_dir: String,
}
```

字段校验:`agentDir` 为非空字符串,长度上限 4096(与 `path`/`sessionsDir` 一致,用 `validate_text` 而非 `validate_id`,因为路径不是 id)。`requestId` 沿用 `validate_id`。

### D2 发送时机 — 每次 Ready 后、OpenBook 前

Rust 在 `handle_event` 的 `SidecarEvent::Ready` 分支中,无论 `recovering` 与否,在 return / replay OpenBook 之前发送 `configure`。这保证:
- 首次启动:Ready 后立即 configure,然后 return,等用户 open_book。
- 恢复启动:Ready 后先 configure,再 replay OpenBook。

agentDir 路径来源:Rust 在 `SupervisorActor` 启动时(`start` / `run_supervisor` 入口)解析一次 `<app_data_dir>/agent/` 并存入 actor 字段 `agent_dir: String`,后续每次 Ready 复用。这样无需每次 Ready 都重新解析路径,且与 `notify_book_opened` 里解析 `app_data_dir()` 的既有做法一致。

实现要点:
- `SupervisorActor` 新增字段 `agent_dir: String`,在 `run_supervisor` 调用 `actor.start_process()` 之前由 `app.path().app_data_dir().join("agent")` 解析并赋值。
- `start_process` 内和 `handle_process_ended` 重启路径里**不需要**单独发 configure(它们只发 bootstrap Ping);configure 统一在 `handle_event(Ready)` 发送。原因:Ready 事件是 sidecar 就绪的唯一信号,在此时发 configure 最可靠,且与现有 replay OpenBook 的时机对齐。
- 在 `handle_event(Ready)` 分支顶部(设 `process_ready=true` 之后)插入:
  ```rust
  let configure = CommandEnvelope {
      protocol_version: AGENT_PROTOCOL_VERSION,
      command: SidecarCommand::Configure {
          request_id: new_id("configure"),
          agent_dir: self.agent_dir.clone(),
      },
  };
  if let Err(error) = self.write_command(&configure) {
      self.emit_command_error("configure", &error, true, &configure);
  }
  ```
  置于 `if self.recovering { ... }` 之前,确保首次与恢复都发送。

### D3 sidecar 接收 configure

sidecar 新增模块级状态 `let agentDir: string | null = null`(类似现有 `currentBook`)。

`handleStateCommand` 新增 `configure` 分支:
```ts
case "configure":
  await handleConfigure(command);
  break;
```

`handleConfigure`:
- 校验 `command.agentDir` 非空(协议层已校验,此处只做存在性断言)。
- 若已有 `currentBook` 且 phase !== loading,仍接受 configure(幂等:更新 agentDir,不重建现有 session;现有 session 已用旧 agentDir 构造,保持不变直到下次 createSession)。实际场景中 configure 只在 Ready 后发,此时无 currentBook,所以幂等主要是防御性设计。
- 存 `agentDir = command.agentDir`。
- 发确认事件 `configured`(见 D4),用于 Rust 侧可选确认;本任务不强制 Rust 等待确认。

`makeResourceLoader()` 改为读取模块级 `agentDir`:
```ts
function makeResourceLoader() {
  const dir = agentDir;
  if (!dir) throw new Error("Agent directory not configured");
  return new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: dir,
    noExtensions: true, noSkills: true, noPromptTemplates: true,
    noThemes: true, noContextFiles: true,
    systemPromptOverride: () => READING_ASSISTANT_PROMPT,
  });
}
```

移除 `process.env.HOME` 硬编码。`createSession` / `loadSessionFromDisk` 调用 `makeResourceLoader()` 时若 `agentDir` 为 null 会抛错 —— 这正是期望行为(未配置前不应创建 session)。但 `open_book` 不依赖 agentDir(BookWorker 只读 EPUB),所以 sidecar 收到 open_book 在未 configure 时应能加载书、只是发 prompt 时才报错。

**修正**:根据 PRD R2,"sidecar 在未收到 configure 前若收到 open_book,应以 error 事件拒绝"。这里需要权衡:
- 严格方案:open_book 在 agentDir 为 null 时拒绝。
- 宽松方案:open_book 允许(书加载不依赖 agentDir),prompt 时才拒绝。

Rust 侧 D2 保证 configure 在 OpenBook 之前发送,所以正常流程不会出现"未 configure 就 open_book"。严格方案更符合 PRD 契约,但会让协议测试更复杂(需要先 configure 再 open_book)。**采用严格方案**:在 `handleOpenBook` 顶部检查 `if (!agentDir) throw new Error("Agent directory not configured")`,与 PRD R2 一致。协议测试中所有 open_book fixture 都需前置 configure。

### D4 确认事件 `configured`

新增事件类型(可选,用于 Rust 侧将来做 confirmed 发送;本任务先实现但非必须等待):
```ts
| { type: "configured"; requestId: string; agentDir: string }
```
sidecar `handleConfigure` 末尾发送。Rust `apply_event_to_snapshot` 不需要为 configured 更新 snapshot(它不影响 UI 状态);只需在 `handle_event` 中识别并忽略(走 `_ => {}` 分支即可)。为保持协议 fixture 一致,需在 `protocol/agent-protocol.jsonl` 增加 configure command 与 configured event 的 fixture 行。

**决策:为减少本任务范围,D4 确认事件暂不实现**。configure 命令采用 fire-and-forget(与现有 OpenBook 在首次启动时的非 confirmed 发送一致)。sidecar 收到 configure 静默更新 agentDir,不发确认事件。若后续需要 confirmed 语义再加。这样 protocol.ts 的 SidecarEvent 不变,只新增 SidecarCommand 类型。

### D5 目录创建

Rust 在解析 `agent_dir` 时(启动时一次)用 `std::fs::create_dir_all` 确保目录存在。失败则记日志但不阻塞启动(sidecar 在目录不存在时 `ModelConfig.load` 返回空 Map 不报错,auth.json 不存在时 `DefaultAuthStorage` 也容忍)。这保证"空目录安全"的验收标准。

### D6 SessionManager 的 cwd 与 agentDir

现状:`SessionManager.create(process.cwd(), sessionDir, { id })` 用 `process.cwd()` 作为 cwd,`sessionDir` 是 session 存储目录。`createAgentSession` 内部当 `agentDir` 显式传入时,用 `<agentDir>/auth.json` 和 `<agentDir>/models.json`。所以 sidecar 只要 `makeResourceLoader` 用新 agentDir,且 `createAgentSession` 通过 `resourceLoader` 间接拿到 agentDir,auth/models 就从新目录读。

需确认:`createAgentSession({ sessionManager, customTools, resourceLoader })` 是否用 resourceLoader 的 agentDir 还是另算?从 sdk.js 源码看,当 `resourceLoader` 传入时,`createAgentSession` 不再自建 `DefaultResourceLoader`,但 `modelRuntime` 仍由 `options.agentDir` 或默认 `getDefaultAgentDir()` 决定 —— **如果 sidecar 只传 resourceLoader 不传 agentDir,modelRuntime 会 fallback 到 `getDefaultAgentDir()` 即 `~/.pi/agent`!**

这是关键风险点。现状 sidecar 代码:
```ts
const { session } = await createAgentSession({ sessionManager: manager, customTools, resourceLoader });
```
没有传 `agentDir`。当前能工作是因为 `resourceLoader` 的 agentDir 和 `getDefaultAgentDir()` 都是 `~/.pi/agent`。改了 resourceLoader 的 agentDir 后,若不显式传 `agentDir`,modelRuntime 会读错地方。

**解决方案**:sidecar 在 `createSession` / `loadSessionFromDisk` 调用 `createAgentSession` 时显式传 `agentDir`:
```ts
const { session } = await createAgentSession({
  sessionManager: manager,
  customTools,
  resourceLoader,
  agentDir,  // ← 新增,确保 modelRuntime 也用同一目录
});
```
这是本任务最关键的改动点之一。

## 变更清单

### sidecar/protocol.ts
- `SidecarCommand` 联合类型新增 `configure` 成员。
- `decodeCommand` 新增 `case "configure"` 分支,校验 `agentDir`(非空,上限 4096)。
- 不新增事件类型。

### sidecar/index.ts
- 移除 `makeResourceLoader` 中 `process.env.HOME` 硬编码,改读模块级 `agentDir`。
- 新增模块级 `let agentDir: string | null = null`。
- 新增 `handleConfigure(command)` 函数,存 agentDir。
- `handleStateCommand` switch 新增 `case "configure"`。
- `handleOpenBook` 顶部检查 `if (!agentDir) throw new Error("Agent directory not configured")`。
- `createSession` / `loadSessionFromDisk` 调用 `createAgentSession` 时新增 `agentDir` 参数。

### src-tauri/src/sidecar_protocol.rs
- `SidecarCommand` enum 新增 `Configure { request_id, agent_dir }` 变体。
- `CommandEnvelope::validate` 新增 `Configure` 分支,校验 `request_id` 与 `agent_dir`(validate_text 上限 4096)。

### src-tauri/src/sidecar.rs
- `SupervisorActor` 新增字段 `agent_dir: String`。
- `run_supervisor` 在 `actor.start_process()` 前解析 `app.path().app_data_dir().join("agent")`,`create_dir_all`,赋值 `actor.agent_dir`。解析失败时用空字符串并记日志(不阻塞)。
- `handle_event` 的 `SidecarEvent::Ready` 分支:在 `process_ready=true` 之后、`recovering` 判断之前,发 `Configure` 命令。

### protocol/agent-protocol.jsonl
- 新增一行 configure command fixture:`{"direction":"command","message":{"protocolVersion":1,"type":"configure","requestId":"req-configure-1","agentDir":"/controlled/agent"}}`

### 测试
- `sidecar/scripts/protocol.node-test.ts`:共享 fixture 自动覆盖 configure(已用 dataEqual round-trip);新增拒绝用例(agentDir 缺失 / 空)。
- `src-tauri/src/sidecar_protocol.rs` tests:共享 fixture 自动覆盖;新增 validate 拒绝用例。
- `src-tauri/src/sidecar.rs` tests:如有 Ready 时序测试,需确认 configure 在 Ready 后发送。

## 数据流

```
Rust startup:
  agent_dir = app_data_dir().join("agent"); create_dir_all(agent_dir)
  SupervisorActor { agent_dir, ... }
  start_process() → Ping → sidecar ready

Ready 事件 → Rust:
  write_command(Configure { agent_dir })
  (若 recovering) write_command(OpenBook replay)

sidecar configure:
  agentDir = command.agentDir  (模块级)

sidecar open_book:
  assert agentDir != null
  BookWorker.load(...) → book_ready

sidecar prompt → createSession:
  makeResourceLoader()  // 用 agentDir
  createAgentSession({ ..., resourceLoader, agentDir })  // modelRuntime 也用 agentDir
  session.prompt(...) → 流式事件
```

## 兼容性与回滚

- 协议版本保持 1;旧 sidecar 不认识 `configure` 会回 error,Rust 侧 `write_command` 失败走 `emit_command_error` 不阻塞后续 OpenBook。但这意味着旧 sidecar 仍用 `~/.pi/agent` —— 本任务要求 sidecar 重新打包,所以实际部署中 sidecar 与 Rust 同步更新,不存在旧 sidecar 场景。回滚 = 回退 sidecar 产物 + Rust 改动。
- 回滚点:若集成出问题,回退 git commit 即可,无数据迁移(独立目录是新创建的,旧 `~/.pi/agent` 未动)。

## 风险

- **R1(modelRuntime fallback)**:如 D6 所述,必须显式传 `agentDir` 给 `createAgentSession`,否则 modelRuntime 读旧目录。已纳入变更清单,实现时重点验证。
- **R2(时序竞争)**:Ready 后 configure 与 OpenBook replay 都在 `handle_event(Ready)` 内顺序发送(write_command 同步写 stdin),无竞争。
- **R3(路径解析失败)**:`app_data_dir()` 失败时用空字符串,sidecar 收到空 agentDir 会被 protocol validate 拒绝(validate_text 非空)。需在 Rust 侧解析失败时记录并让 sidecar 启动后 configure 失败明确报错,而非静默。决策:解析失败时 `agent_dir` 设为空,configure 的 validate 会失败,Rust `emit_command_error` 记录错误;sidecar 仍能 ready 但后续 open_book 会因 agentDir null 报错。可接受(与"未配置时报错"语义一致)。

## Out of Scope

- configure 确认事件(D4 暂不实现)。
- UI(属 child 2)。
- 重新打包流程的 CI(本任务手动 `npm run build` 产出 sidecar dist)。