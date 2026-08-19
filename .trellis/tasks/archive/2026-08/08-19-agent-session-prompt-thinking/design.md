# Agent 每会话系统提示词与思考强度配置 — 设计

## 1. 数据模型

### 新增 entry 类型:`session_config`

沿用现有 entry 树机制(`id / parentId / timestamp / type`),新增类型 `session_config`,字段:

```json
{
  "type": "session_config",
  "id": "<uuid>",
  "parentId": "<当前 leafId>",
  "timestamp": "<rfc3339>",
  "systemPrompt": "<string 或缺省>",
  "thinkingLevel": "<string 或缺省>"
}
```

- 每次修改配置 append 一条新 `session_config`(与 `session_info` 重命名同模式),取**最新一条**生效。
- 字段允许缺省(只改提示词时无 thinkingLevel,反之亦然);旧会话文件没有 `session_config` → 视为未设置。
- 清空系统提示词 = 保存 `systemPrompt: ""`,运行时空字符串回退默认 `SYSTEM_PROMPT`;思考强度缺省 = `"off"`。
- 历史兼容:老会话文件(无此 entry)读不到配置,走默认值;`piContextMessages` / 前端 `visibleMessages` 不关心该类型,自然忽略,无需改动。

## 2. 后端(Rust)改动

### `src-tauri/src/pi_sessions.rs`

- `PiSessionSummary` 增加字段:`system_prompt: Option<String>`、`thinking_level: Option<String>`(serde camelCase)。
- `list()` 中,在读取 `session_info` 标题的同一遍历里,取最新 `session_config` entry,提取 `systemPrompt` / `thinkingLevel` 填入 summary。
- **无需新 tauri 命令**:写入复用 `append_agent_session_entries`(前端构造 entry 后 append,与 `renameSession` 相同模式)。
- 迁移/校验:`validate_entry` 只校验通用字段(id/parentId/type/timestamp),`session_config` 自然通过,无需改。

## 3. 前端 TypeScript

### `src/agent/sessions/pi-session.ts`

- `PiSessionEntry` 泛型字段已支持,无需改动结构;新增辅助函数读取最新配置:

```ts
export function sessionConfig(session: DecodedPiSession): { systemPrompt: string; thinkingLevel: string } | null
```

从 `activeBranch(session)` 中倒序找最新 `session_config`。

### `src/types/agent.ts`

- `AgentSessionSummary` 增加 `systemPrompt?: string`、`thinkingLevel?: string`(list 返回即携带)。
- `AgentEvent` 增加 `session_config_updated`(BookCorrelation + sessionId + requestId)。

### `src/agent/runtime/embedded-runtime.ts`

- `updateSessionConfig(sessionId, systemPrompt, thinkingLevel, requestId?)`:
  - 校验长度(`systemPrompt` ≤ 16KB 等,与 prompt 校验风格一致)。
  - `newEntry("session_config", session.leafId, { systemPrompt, thinkingLevel })` → `sessions.append` → 更新内存 session 与 leafId。
  - `this.agent = null`(下次 prompt 重建,配置立即生效)。
  - emit `session_config_updated`。
- `ensureAgent`:构建 `Agent` 时从 session 读最新配置:
  - `systemPrompt = configuredSystemPrompt || SYSTEM_PROMPT`。
  - `thinkingLevel = clampThinkingLevel(model, configuredThinkingLevel || "off")`,导入 `@earendil-works/pi-ai` 的 `clampThinkingLevel`(custom 模型 `reasoning:false` → 钳到 `off`;不支持的等级钳到最近可用)。
- 会话切换/新建本就 `this.agent = null` → 各会话配置天然独立生效。

### `src/lib/use-agent-bridge.ts`

- 新增 `updateSessionConfig(sessionId, systemPrompt, thinkingLevel)`(内部生成 requestId,调用 runtime;与 `renameSession` 模式一致)。

### `src/lib/agent-reducer.ts`

- 处理 `session_config_updated` 事件:更新 `sessions` 列表中对应 summary 的 `systemPrompt`/`thinkingLevel`(upsert 模式)。

### UI:`SessionList.tsx` + `ChatPanel.tsx`

- `SessionList` 每个会话条目在重命名旁新增"会话设置"按钮(齿轮 `Settings` 图标,与重命名/删除同列)。
- 新增 props:`onOpenSettings(session)`;条目数据带 `systemPrompt`/`thinkingLevel` 供弹窗预填。
- `ChatPanel`:
  - 新增状态 `configSessionId: string | null` 与受控表单状态(systemPrompt 草稿、thinkingLevel)。
  - 新增 `SessionConfigDialog`(放 `src/components/chat/`):基于现有 `Dialog` 组件;内容 = 系统提示词 `Textarea`(带"恢复默认"清空按钮)+ 思考强度 `Select`(off/minimal/low/medium/high/xhigh/max,含 max)+ 保存/取消。保存调用 bridge `updateSessionConfig`。
  - `SessionList` 的 `onConfigOpen` 打开该会话弹窗;正在 streaming 时禁用按钮(与重命名/删除一致)。

## 4. 事件流

```
SessionList 齿轮 → SessionConfigDialog(预填自 summary)
  → 保存 → bridge.updateSessionConfig(sessionId, prompt, level)
    → runtime: append session_config → agent 重建 → emit session_config_updated
      → reducer 更新 sessions 列表
下一条 prompt → ensureAgent 读最新 session_config → 新 systemPrompt + clamp 后 thinkingLevel
```

## 5. 兼容性与风险

- 会话文件格式:只新增 entry 类型,`SESSION_VERSION` 保持 3(类型可扩展,无需版本 bump;老版本应用读新文件时忽略未知 entry——`validate_entry` 不拒绝未知类型,`piContextMessages` 忽略)。
- `clampThinkingLevel` 导入自 `@earendil-works/pi-ai`(项目已是依赖)。
- agent 重建会丢失运行中状态,但 prompt 是串行的(`promptId` 互斥),配置修改仅在非 streaming 时允许(UI 禁用),安全。

## 6. 测试计划

- `embedded-runtime.test.ts`:① 有 `session_config` 的会话,prompt 时传给 stream 的 context 含自定义 systemPrompt;② thinkingLevel 传参(clamp 后);③ `updateSessionConfig` 后 agent 重建、下次 prompt 用新配置。
- `pi-session.test.ts`:`sessionConfig()` 读取最新一条、字段缺省、无 entry 返回 null。
- `pi_sessions.rs`:`list()` 摘要含最新 `session_config` 字段;未知类型 entry 不破坏读取(现有测试覆盖格式)。
- 组件测试 `ChatPanel.test.tsx` / 新增 `SessionConfigDialog` 测试:打开弹窗、预填、保存调用 bridge、清空按钮。
- `agent-reducer.test.ts`:`session_config_updated` 更新摘要。
