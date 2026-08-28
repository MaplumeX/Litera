# Implement: Agent runtime iteration

## 执行顺序（每步独立可验证，按此顺序 commit）

### Step 1: R9 死代码清理
- [ ] 删除 `src/agent/runtime/pi-spike.ts`、`src/agent/runtime/pi-spike.test.ts`
- [ ] 删除 `src/agent/sessions/pi-session.ts` 的 `windowCompleteTurns` 及 `pi-session.test.ts` 中对应测试
- [ ] 验证：`npx tsc --noEmit`、`npx vitest run`（项目等效命令见下方"验证命令"）
- 回滚点：独立 commit `refactor(agent): remove dead spike code`

### Step 2: R1 错误信息区分
- [ ] 新建 `src/agent/runtime/prompt-error.ts`：`classifyPromptError()` 分类函数（auth/rate_limited/server/network/context_overflow/unknown → 预置中文文案，不拼接原始错误）
- [ ] 新建 `src/agent/runtime/prompt-error.test.ts`：每类输入断言分类与文案
- [ ] `embedded-runtime.ts` `prompt()` catch：用 `classifyPromptError` 替换统一文案；`isContextOverflow` 优先判定
- [ ] 验证：单测 + 手动模拟（可在测试中 mock streamFn 抛不同错误）

### Step 3: R2 请求重试
- [ ] `embedded-runtime.ts` `ensureAgent`：`maxRetries: 0` → `3`
- [ ] `prompt()` 外层接 `retryAssistantCall`（`RetryPolicy {enabled:true, maxRetries:3, baseDelayMs:500}`），`onRetryScheduled` emit 新事件 `retry_scheduled`
- [ ] `src/types/agent.ts` 增加 `retry_scheduled` 事件类型；`agent-reducer.ts` 对未知事件安全忽略（确认 default 分支已覆盖）
- [ ] 测试：mock 前两次 429 / 第三次成功 → 断言事件与最终成功；mock 401 → 不重试
- 回滚点：`feat(agent): add bounded retry with backoff`

### Step 4: R3 自定义模型窗口自动解析（方案 A）
- [ ] 前端 `model-resolution.ts`：新增模块级懒加载的全 provider 目录索引（`Map<modelId, Model>`）；`resolveRuntimeModel` custom 分支依次：目录命中（保留 custom baseUrl，用目录 contextWindow/maxTokens）→ `config.contextWindow`（Rust 探测值）→ 默认 128_000/8_192
- [ ] Rust：`add_custom_provider` / `update_custom_provider` 保存时探测 `/models`（复用 `models_endpoint_url`），解析 OpenRouter `context_length` / vLLM `max_model_len`，写入 models.json model 条目可选 `contextWindow` 字段；maxTokens = contextWindow/8；探测失败不写字段不报错
- [ ] `read_runtime_config`：读取选中 model 条目的 `contextWindow` → `AgentRuntimeConfig.context_window: Option<u64>`（skip_serializing_if None）
- [ ] `RuntimeConfig`（TS）增加可选 `contextWindow` 字段
- [ ] 测试：`model-resolution.test.ts` 三层用例；Rust 探测解析单测（含/不含窗口字段、探测失败无副作用）
- 回滚点：`feat(agent): resolve custom model context window from catalog, probe, and default`

### Step 5: R7 thinking 透传
- [ ] `src/types/agent.ts`：增加 `thinking_start/delta/end` 事件
- [ ] `embedded-runtime.ts` `onPiEvent`：转发三个 thinking 事件
- [ ] `src/types/agent.ts` `AgentMessage` 增加可选 `thinking` 字段；`agent-reducer.ts` 处理 `thinking_delta`（追加）
- [ ] `AssistantMessage.tsx`：可折叠「思考过程」块（默认折叠、流式展开、prompt_end 收起）
- [ ] 测试：reducer 流测试 + 组件折叠渲染测试
- 回滚点：`feat(agent): surface thinking deltas in chat UI`

### Step 6: R5 会话标题自动生成
- [ ] `embedded-runtime.ts`：`prompt()` 末尾 fire-and-forget 标题任务（仅第一轮且非 abort）
  - 独立 sessionId、`cacheRetention:"none"`、`maxTokens:64`、同一 nativeFetch
  - 成功 → 复用 renameSession 逻辑 emit `session_renamed`；用户已手动改名则放弃
  - 失败 → 静默，保持 `first_user_text` fallback
- [ ] 测试：成功/失败/已改名三路 mock
- 回滚点：`feat(agent): auto-generate session title after first turn`

### Step 7: 收尾
- [ ] 全量验证（见下）
- [ ] spec 更新（Phase 3.3）
- [ ] 各步骤 commit 汇总推送

## 验证命令

```bash
npx tsc --noEmit          # 或 npm run build（含 tsc）
npx vitest run            # 前端测试
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 测试
```

## 风险文件

- `src/agent/runtime/embedded-runtime.ts`（R1/R2/R5/R7 四处改动，最易冲突；prompt() 已很长，改时保持现有紧凑风格与守卫模式）
- `src-tauri/src/agent_config.rs`（R3 触及 1889 行文件的读写路径；改动集中在 models_json/read_runtime_config/update_custom_provider_impl/add_custom_provider_impl）

## 给 sub-agent 的注意事项

- 现有代码风格紧凑（单行方法、分号无空格），匹配而不要重排。
- 所有用户可见文案为中文。
- 新事件类型必须带 `PromptCorrelation`（bookId/sessionId/promptId），reducer 用 `matchesPrompt` 过滤。
- 不要使用 pi-agent-core harness 层的 compaction 导出——项目有自己的 `src/agent/compaction/`。
- pi-ai 的 `retryAssistantCall`/`isRetryableAssistantError` 从 `@earendil-works/pi-ai` 主入口导入（index.d.ts 已 re-export）。