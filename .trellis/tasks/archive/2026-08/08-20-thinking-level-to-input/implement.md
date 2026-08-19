# Implement — 思考强度从会话级移到输入框附近(全局级)

## 执行顺序

按依赖方向自底向上：Rust storage → TS types → TS runtime → TS reducer/bridge → UI → 测试 → 验证。

### Step 1: Rust — settings.json 读写与 snapshot 暴露

**文件**: `src-tauri/src/agent_config.rs`

1. `AgentConfigSnapshot` 增加 `pub thinking_level: String`
2. `read_snapshot` 读 `settings.json` `defaultThinkingLevel`，缺省 `"medium"`
3. `AgentRuntimeConfig` 增加 `pub thinking_level: String`，`read_runtime_config` 同样读取
4. 新增 `#[tauri::command] pub async fn set_thinking_level(app, level: String)`：
   - 校验 level ∈ ["off","minimal","low","medium","high","xhigh","max"]
   - 读 settings.json → 写 `defaultThinkingLevel` → 原子写回
5. `save_agent_config` 改为：若 settings 已有 `defaultThinkingLevel` 则保留，否则初始化 `"medium"`
6. 在 `lib.rs` 或 invoke handler 注册 `set_thinking_level`

**验证**: `cargo test -p litera agent_config`（更新对应断言）

### Step 2: Rust — PiSessionSummary 移除 thinking_level

**文件**: `src-tauri/src/pi_sessions.rs`

1. `PiSessionSummary` 去掉 `thinking_level: Option<String>`
2. `list()` 不再读 `session_config.thinkingLevel`
3. 更新 `list_exposes_the_latest_session_config` 测试：去掉 thinkingLevel 断言

**验证**: `cargo test -p litera pi_sessions`

### Step 3: TS types 更新

**文件**: `src/types/agent.ts`, `src/types/agent-config.ts`

1. `AgentSessionSummary` 删 `thinkingLevel?: string`
2. `AgentEvent` 的 `session_config_updated` 删 `thinkingLevel`
3. `AgentConfigSnapshot` 增 `thinkingLevel: string`

### Step 4: TS session 层

**文件**: `src/agent/sessions/pi-session.ts`

1. `SessionConfig` 接口删 `thinkingLevel`
2. `sessionConfig()` 返回值删 thinkingLevel
3. `sessionSummary()` 删 thinkingLevel 处理
4. 更新 `pi-session.test.ts`：所有 thinkingLevel 断言移除/调整

### Step 5: TS runtime 层

**文件**: `src/agent/runtime/embedded-runtime.ts`

1. `RuntimeConfig` 增 `thinkingLevel: string`
2. `ensureAgent` 改为 `clampThinkingLevel(resolvedModel, config.thinkingLevel as ModelThinkingLevel)`，不再读 sessionConfig 的 thinkingLevel
3. `updateSessionConfig(sessionId, systemPrompt,requestId)` — 去掉 thinkingLevel 参数与校验
4. `session_config_updated` emit 去掉 thinkingLevel
5. 更新 `embedded-runtime.test.ts`

### Step 6: TS bridge / reducer

**文件**: `src/lib/use-agent-bridge.ts`, `src/lib/agent-reducer.ts`

1. `updateSessionConfig(sessionId, systemPrompt)` — 去掉 thinkingLevel
2. reducer `session_config_updated` 分支删 thinkingLevel
3. 更新 `agent-reducer.test.ts`

### Step 7: UI — ChatInput 加控件

**文件**: `src/components/chat/ChatInput.tsx`

1. props 增 `thinkingLevel: string`, `onThinkingLevelChange: (l: string) => void`
2. 工具栏行左侧加 `Select`（shadcn），7 档，disabled={isStreaming}
3. 保持现有 input hint 或合并布局

### Step 8: UI — ChatPanel 接线

**文件**: `src/components/chat/ChatPanel.tsx`

1. 从 `configSnapshot` 读 `thinkingLevel`
2. `handleThinkingLevelChange`: `invoke("set_thinking_level", { level })` → `embeddedAgentRuntime.invalidateConfig()` → `loadConfig()`
3. 传 props 给 `ChatInput`
4. `handleSaveSessionConfig(systemPrompt)` — 去掉 thinkingLevel

### Step 9: UI — SessionConfigDialog 移除字段

**文件**: `src/components/chat/SessionConfigDialog.tsx`, `SessionConfigDialog.test.tsx`

1. 删思考强度 Select 区块、`levelDraft` state、`THINKING_LEVELS` 常量
2. `onSave: (systemPrompt: string) => void`
3. `SessionConfigTarget` 删 thinkingLevel
4. 更新测试

### Step 10: i18n 文案

**文件**: `src/locales/zh-CN.ts`, `src/locales/en.ts`

1. `chat.sessionConfigDescription` 改为只提 systemPrompt
2. 其余 key 复用

### Step 11: 全量验证

```bash
cargo test
pnpm test
pnpm typecheck
pnpm lint
```

## 验证命令

| 命令 | 期望 |
|------|------|
| `cargo test agent_config` | snapshot 含 thinking_level；set_thinking_level 写入；save_agent_config 保留已有值 |
| `cargo test pi_sessions` | summary 无 thinking_level 字段 |
| `pnpm test src/agent/sessions/pi-session.test.ts` | sessionConfig 不含 thinkingLevel |
| `pnpm test src/agent/runtime/embedded-runtime.test.ts` | ensureAgent 用 config.thinkingLevel |
| `pnpm test src/lib/agent-reducer.test.ts` | session_config_updated 无 thinkingLevel |
| `pnpm test src/components/chat/SessionConfigDialog.test.tsx` | 无思考强度字段 |
| `pnpm test src/components/chat/ChatPanel.test.tsx` | ChatInput 收到 thinkingLevel props |
| `pnpm typecheck` | 全绿 |

## Review Gates

- Step 1-2 完成后：cargo test 绿
- Step 3-6 完成后：pnpm test 绿（session/runtime/reducer）
- Step 7-10 完成后：pnpm test + typecheck + lint 全绿
- Step 11：全量验证

## 回滚点

每个 Step 都是独立提交单元；任何 Step 失败可 git revert 该 step 的 commit。