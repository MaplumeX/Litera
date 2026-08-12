# Implement — Agent dir protocol (child 1)

执行顺序严格自下而上。每步完成后运行该步 validation;全部完成后跑全量 validation 再 commit。

## Step 1 — 协议层:新增 configure 命令(双侧)

### 1a sidecar/protocol.ts
- [ ] `SidecarCommand` 联合类型新增:`| { protocolVersion: 1; type: "configure"; requestId: string; agentDir: string }`
- [ ] `decodeCommand` switch 新增 `case "configure"`:
  ```ts
  case "configure":
    return {
      protocolVersion, type, requestId,
      agentDir: requiredString(input.agentDir, "agentDir", 4096),
    };
  ```

### 1b src-tauri/src/sidecar_protocol.rs
- [ ] `SidecarCommand` enum 新增变体:
  ```rust
  Configure {
      #[serde(rename = "requestId")]
      request_id: String,
      #[serde(rename = "agentDir")]
      agent_dir: String,
  },
  ```
- [ ] `CommandEnvelope::validate` 新增分支:
  ```rust
  SidecarCommand::Configure { request_id, agent_dir } => {
      validate_id("requestId", request_id)?;
      validate_text("agentDir", agent_dir, 4096)
  }
  ```

### 1c protocol/agent-protocol.jsonl
- [ ] 新增 fixture(command direction),放在 ping 之后、open_book 之前:
  ```json
  {"direction":"command","message":{"protocolVersion":1,"type":"configure","requestId":"req-configure-1","agentDir":"/controlled/agent"}}
  ```

**Validation**:
```bash
cd sidecar && npm run test
cd ../src-tauri && cargo test --lib sidecar_protocol
```
共享 fixture round-trip 测试应自动覆盖 configure;新增类型若编解码不一致会立即失败。

## Step 2 — sidecar 接收 configure 并改用 agentDir

### 2a sidecar/index.ts:模块级状态
- [ ] 移除 `makeResourceLoader` 中 `agentDir: process.env.HOME ? ... : "/tmp/.pi/agent"`,改读模块级 `agentDir`:
  ```ts
  let agentDir: string | null = null;
  ```
  `makeResourceLoader` 内:`if (!agentDir) throw new Error("Agent directory not configured");` 然后 `agentDir: agentDir`。

### 2b sidecar/index.ts:handleConfigure
- [ ] 新增:
  ```ts
  async function handleConfigure(command: Extract<SidecarCommand, { type: "configure" }>): Promise<void> {
    agentDir = command.agentDir;
  }
  ```

### 2c sidecar/index.ts:handleStateCommand
- [ ] switch 新增 `case "configure": await handleConfigure(command); break;`(放在 `case "open_book"` 之前)。

### 2d sidecar/index.ts:open_book 守卫
- [ ] `handleOpenBook` 顶部:`if (!agentDir) throw new Error("Agent directory not configured");`

### 2e sidecar/index.ts:createAgentSession 传 agentDir
- [ ] `createSession`:`createAgentSession({ sessionManager: manager, customTools, resourceLoader, agentDir })`
- [ ] `loadSessionFromDisk`:同上,加 `agentDir`。
- [ ] grep 确认无 `process.env.HOME` 残留:`grep -rn "process.env.HOME\|\.pi/agent" sidecar/index.ts` 应无匹配。

**Validation**:
```bash
cd sidecar && npm run typecheck && npm run test
```

## Step 3 — Rust:Ready 后发 configure

### 3a src-tauri/src/sidecar.rs:SupervisorActor 字段
- [ ] `SupervisorActor` struct 新增 `agent_dir: String`。
- [ ] `run_supervisor` 初始化 `agent_dir`:在 `actor.start_process()` 之前:
  ```rust
  let agent_dir = app
      .path()
      .app_data_dir()
      .map(|dir| dir.join("agent"))
      .map(|dir| dir.to_string_lossy().to_string())
      .unwrap_or_default();
  let _ = std::fs::create_dir_all(&agent_dir);
  actor.agent_dir = agent_dir;
  ```
  (注意:`app.path()` 需在 supervisor 线程内调用;`run_supervisor` 已持有 `app: tauri::AppHandle`,可调用。`create_dir_all` 对空字符串会失败,用 `let _ =` 忽略。)

### 3b src-tauri/src/sidecar.rs:Ready 分支发 configure
- [ ] `handle_event` 的 `SidecarEvent::Ready` 分支,在 `self.process_ready = true;` 之后、`if self.recovering {` 之前插入:
  ```rust
  if !self.agent_dir.is_empty() {
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
  }
  ```

**Validation**:
```bash
cd src-tauri && cargo build 2>&1 | tail -20
cd src-tauri && cargo test --lib sidecar
```

## Step 4 — 全量验证

- [ ] sidecar 重新打包:`cd sidecar && npm run build`(产出 `dist/litera-sidecar.cjs`)
- [ ] sidecar 全量测试:`cd sidecar && npm run test`
- [ ] Rust 全量测试:`cd src-tauri && cargo test`
- [ ] grep 确认无残留:`grep -rn "process.env.HOME\|\.pi/agent" sidecar/index.ts sidecar/protocol.ts` 无匹配
- [ ] 手动集成验证(需配置文件):
  - 在 `<app_data_dir>/agent/` 放置有效 `auth.json` + `settings.json`(从本机 pi 复制 api_key 条目)
  - 启动 Litera,打开书,发送 prompt,确认流式返回
  - 删除/重命名 `~/.pi/agent`,重启 Litera,确认仍正常工作
  - 未放配置时打开书发 prompt,确认报"未配置"而非崩溃

## Review Gate

在 `task.py start` 后由 `trellis-check` sub-agent 验证:
- 协议 fixture 双侧 round-trip
- grep 无 `~/.pi/agent` 残留
- createAgentSession 显式传 agentDir(D6 风险点)
- Ready 后 configure 先于 OpenBook

## Rollback Points

- Step 1-3 均为代码改动,无数据迁移。回滚 = `git checkout` 对应文件。
- sidecar dist 产物回滚 = 重新 `npm run build` 旧代码或 `git checkout sidecar/dist/litera-sidecar.cjs`。
- 独立 `<app_data_dir>/agent/` 目录可保留(不影响旧版本,旧版本仍读 `~/.pi/agent`)。