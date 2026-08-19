# Agent 每会话系统提示词与思考强度配置 — 执行计划

## 顺序(依赖:后端 → 类型 → runtime → bridge/reducer → UI → 收尾)

### 1. 后端 Rust:`src-tauri/src/pi_sessions.rs`

- [ ] `PiSessionSummary` 增加 `system_prompt: Option<String>`、`thinking_level: Option<String>`。
- [ ] `list()` 遍历时,取最新 `session_config` entry 的 `systemPrompt`/`thinkingLevel` 填入 summary。
- [ ] 补 Rust 测试:list 摘要携带最新 session_config 字段;无该 entry 时为 None。

### 2. 前端类型与会话解析

- [ ] `src/types/agent.ts`:`AgentSessionSummary` 增加 `systemPrompt?`、`thinkingLevel?`;`AgentEvent` 增加 `session_config_updated`。
- [ ] `src/agent/sessions/pi-session.ts`:新增 `sessionConfig(session)` 辅助(取 activeBranch 最新 `session_config`,字段缺省容错)。
- [ ] `pi-session.test.ts` 补测试。

### 3. Runtime:`src/agent/runtime/embedded-runtime.ts`

- [ ] 新增 `updateSessionConfig(sessionId, systemPrompt, thinkingLevel, requestId?)`:校验长度 → append `session_config` entry → 更新内存 → `this.agent = null` → emit 事件。
- [ ] `ensureAgent`:`systemPrompt = sessionConfig?.systemPrompt || SYSTEM_PROMPT`;`thinkingLevel = clampThinkingLevel(model, sessionConfig?.thinkingLevel || "off")`。
- [ ] `embedded-runtime.test.ts` 补测试(自定义提示词进入请求、clamp 生效、updateSessionConfig 后重建 agent)。

### 4. Bridge 与 Reducer

- [ ] `src/lib/use-agent-bridge.ts`:新增 `updateSessionConfig(sessionId, systemPrompt, thinkingLevel)`。
- [ ] `src/lib/agent-reducer.ts`:处理 `session_config_updated`,更新 sessions 摘要。
- [ ] 补对应测试。

### 5. UI

- [ ] 新增 `src/components/chat/SessionConfigDialog.tsx`:系统提示词 Textarea(含清空/恢复默认)+ 思考强度 Select(off/minimal/low/medium/high/xhigh/max)+ 保存/取消;i18n key。
- [ ] `SessionList.tsx`:条目新增"会话设置"齿轮按钮 + `onOpenSettings` prop;streaming 时禁用。
- [ ] `ChatPanel.tsx`:接弹窗状态与保存逻辑。
- [ ] 组件测试:弹窗预填/保存/清空;`ChatPanel.test.tsx` 打开流程。
- [ ] `src/locales/zh-CN.ts` / `en.ts` 补 i18n key。

### 6. 收尾

- [ ] `npm test` 全量通过;`npx tsc --noEmit` 干净。
- [ ] 更新 `CHANGELOG.md`(Added 条目)。
- [ ] spec 更新(`.trellis/spec/frontend/component-guidelines.md` 或 state-management,如新增约定)。

## 验证命令

```bash
npm test -- --run          # 全量测试
npx tsc --noEmit           # 类型检查
npm run build              # 构建
```

## 评审门

- 后端与前端交接点(entry 字段名、summary 字段)在步骤 2 完成后由 check 子代理复核一次。
- 全部完成后跑全量 check(测试 + tsc + build)。
