# Design — 思考强度从会话级移到输入框附近(全局级)

## 影响层与边界

改动跨 Rust 后端 + TS 前端，核心是「数据来源从 session_config → 全局 settings.json」。

```
storage            rust command         TS runtime              UI
settings.json  ──▶ get_agent_config  ──▶ useAgentConfig     ──▶ ChatInput 控件
   ↑                  (新增 thinkingLevel)   (读 snapshot)
   │ set_thinking_level (新)                     │
   └──────────── invalidateConfig ◀─────────────┘ (切换时)
```

session_config entry 仍可存在（只用于 systemPrompt），但 thinkingLevel 字段：
- 写入端：`updateSessionConfig` 不再写 thinkingLevel
- 读取端：`sessionConfig()` / `PiSessionSummary` 不再暴露 thinkingLevel
- 兼容：旧 entry 里的 thinkingLevel 自然被忽略

## 数据模型变更

### Rust (`agent_config.rs`)

`AgentConfigSnapshot` 增加 `thinking_level: String`：
```rust
pub struct AgentConfigSnapshot {
    pub configured: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub has_api_key: bool,
    pub custom_providers: Vec<CustomProviderEntry>,
    pub thinking_level: String,       // ← 新增
}
```
来源：`read_snapshot` 读 `settings.json` 的 `defaultThinkingLevel`，缺省 `"medium"`（与 save_agent_config 现状一致）。

新 command `set_thinking_level(level: String)`：
- 校验 level ∈ 7 档
- 只写 `settings.json` 的 `defaultThinkingLevel`，不动 provider/model/auth
- 不需要 invalidate runtime（runtime 在下次 ensureAgent 时从 config 读）

`save_agent_config` 现在硬写 `"medium"` 的行为改为：保留已有 `defaultThinkingLevel`（若已存在），否则初始化为 `"medium"`。避免保存 provider 时把用户已选的思考强度覆盖回 medium。

### Rust (`pi_sessions.rs`)

`PiSessionSummary` 移除 `thinking_level` 字段。`list()` 不再读 `session_config.thinkingLevel`。

### TS types (`types/agent.ts`)

- `AgentSessionSummary` 移除 `thinkingLevel?: string`
- `AgentEvent` 的 `session_config_updated` 去掉 `thinkingLevel`

### TS types (`types/agent-config.ts`)

`AgentConfigSnapshot` 增加 `thinkingLevel: string`。

### TS session (`agent/sessions/pi-session.ts`)

- `SessionConfig` 接口移除 `thinkingLevel`
- `sessionConfig()` 返回值不再含 thinkingLevel
- `sessionSummary()` 不再读/写 thinkingLevel
- 测试相应更新（`pi-session.test.ts` 多处断言 thinkingLevel）

### TS runtime (`agent/runtime/embedded-runtime.ts`)

- `updateSessionConfig(sessionId, systemPrompt, requestId)` — 去掉 thinkingLevel 参数
- `ensureAgent` — thinkingLevel 来源改为从 `config`（即 `loadConfig()` 结果）读取，而非 `sessionConfig(session)`
- `THINKING_LEVELS` 常量保留（仍用于校验）

`ensureAgent` 关键改动：
```ts
// 旧
const configured = sessionConfig(session);
thinkingLevel: clampThinkingLevel(resolvedModel, (configured?.thinkingLevel || "off") as ModelThinkingLevel)

// 新
// thinkingLevel 来自 RuntimeConfig（需要扩展 RuntimeConfig 携带 thinkingLevel）
thinkingLevel: clampThinkingLevel(resolvedModel, config.thinkingLevel as ModelThinkingLevel)
```

`RuntimeConfig` 扩展：
```ts
export interface RuntimeConfig {
  provider: string; model: string; api: string;
  baseUrl: string; apiKey: string;
  thinkingLevel: string;   // ← 新增
}
```
`get_agent_runtime_config` 对应 Rust 端也要返回 thinkingLevel（`AgentRuntimeConfig` 增加字段）。

### TS bridge / reducer

- `updateSessionConfig(sessionId, systemPrompt)` — 去掉 thinkingLevel
- `agent-reducer.ts` `session_config_updated` 分支去掉 thinkingLevel 处理
- reducer 测试更新

### UI (`ChatInput.tsx`)

在工具栏行（`<div className="flex items-center justify-between">`）的左侧 input hint 旁或替换之，加一个思考强度 Select（shadcn `Select`，已在用）：
```tsx
<Select value={thinkingLevel} onValueChange={onThinkingLevelChange} disabled={isStreaming}>
  <SelectTrigger size="xs"><SelectValue /></SelectTrigger>
  ...
</Select>
```
- props 增加 `thinkingLevel: string`、`onThinkingLevelChange: (level: string) => void`
- 流式中 disabled

### UI (`ChatPanel.tsx`)

- 从 `useAgentConfig().snapshot` 读 `thinkingLevel`
- 切换时调用 `invoke("set_thinking_level", { level })` → `embeddedAgentRuntime.invalidateConfig()` → `loadConfig()` 刷新
- 传给 `ChatInput`
- `handleSaveSessionConfig(systemPrompt)` — 去掉 thinkingLevel

### UI (`SessionConfigDialog.tsx`)

- 移除思考强度 Select 区块
- `onSave: (systemPrompt: string) => void`
- props `SessionConfigTarget` 去掉 thinkingLevel
- 测试更新

### UI (`SessionList.tsx`) — 检查是否消费 thinkingLevel
（从 grep 看不消费，但需确认）

## 数据流（切换思考强度）

```
用户在 ChatInput 选 "high"
  → ChatPanel.onThinkingLevelChange("high")
  → invoke("set_thinking_level", { level: "high" })
  → loadConfig() 刷新 snapshot
  → embeddedAgentRuntime.invalidateConfig()
  → 下次 prompt → ensureAgent → config.thinkingLevel="high" → clampThinkingLevel
```

## 数据流（发消息时）

```
prompt() → loadConfig() → RuntimeConfig{ thinkingLevel } → ensureAgent → clampThinkingLevel(model, config.thinkingLevel)
```
不再读 session_config.thinkingLevel。

## 权衡与兼容

- **不删旧 session_config.thinkingLevel**：旧 jsonl 里的字段仍存在，但读取端全部忽略。无迁移风险。
- **save_agent_config 不再覆盖 thinkingLevel**：用户在输入框选了 high，换 provider 后仍保持 high。首次安装初始化为 medium。
- **不支持思考的模型**：`clampThinkingLevel` 已处理安全降级，无需额外 UI 逻辑。
- **invalidateConfig 时机**：切换思考强度后 invalidate，下次 prompt 重建 Agent。当前正在进行的 prompt 不受影响（与切 provider 一致）。

## 回滚

- 全部改动集中在 ~10 个文件，git revert 即可。
- 旧 session_config 数据未删除，回滚后可恢复旧行为。