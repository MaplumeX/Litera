# Implement — Replace abort input backfill with regenerate affordance

## 阶段 1：数据契约（投影层 + 持久化）

- [ ] 1.1 `src/types/agent.ts`：`AgentMessage` 增加 `stopReason?: "aborted" | "error"`。
- [ ] 1.2 `src/agent/sessions/pi-session.ts` `visibleMessages()`：
  - 用户消息投影透传 entry payload 的 `selection` / `chapterHref`；
  - assistant 消息投影 `stopReason`（仅 aborted/error 时携带）。
- [ ] 1.3 `src/agent/runtime/embedded-runtime.ts` prompt 流程：用户消息 entry payload 写入 `selection` / `chapterHref`（有值时）。
- [ ] 1.4 确认 Rust 侧 `pi_sessions.rs` append 对新增 payload 字段透传无强类型拦截（若有则同步加 optional 字段）。
- [ ] 1.5 单测：`pi-session` 投影测试补 selection/chapterHref/stopReason 用例；`embedded-runtime` 测试断言 entry payload 含上下文字段。

验证：`npx vitest run src/agent/sessions src/agent/runtime` 

## 阶段 2：移除回填

- [ ] 2.1 `ChatPanel.tsx`：删除 `lastSentRef`、`abortedRef`、回填 effect、`retryHighlight`；`handleSend` / `handleSaveEdit` 清理相关赋值。
- [ ] 2.2 `ChatInput.tsx`：删除 `retryHighlight` prop 与高亮类名。
- [ ] 2.3 `ChatInput.test.tsx` 及其他引用处清理；新增/改写测试：abort 后输入框为空。

验证：`npx vitest run src/components/chat src/App.reader-mode.test.tsx`

## 阶段 3：Regenerate 按钮

- [ ] 3.1 `src/locales/en.ts` + `zh-CN.ts`：新增 `chat.regenerate`、`chat.stopped`。
- [ ] 3.2 `ChatPanel.tsx`：`handleRegenerate`（findLast user index → `editPrompt` 原文重发）；流式中清 `editingIndex`。
- [ ] 3.3 对话流底部渲染 regenerate 按钮（`!isStreaming && bookReady && 存在 user 消息`），样式对齐 `CopyButton`（ghost 小图标 + 文案）。
- [ ] 3.4 测试：
  - 点击 regenerate 调用 `editPrompt`，参数为最后一条 user 消息原文与上下文；
  - 流式中按钮不可见/禁用；
  - 无 user 消息时不渲染；
  - 空会话不渲染。

验证：`npx vitest run src/components/chat`

## 阶段 4：Aborted 标识

- [ ] 4.1 `AssistantMessage.tsx`：`stopReason === "aborted"` 时显示"已停止"小标签。
- [ ] 4.2 测试：aborted 消息渲染标签；正常消息不渲染。

## 阶段 5：全量验证与收尾

- [ ] 5.1 全量测试：`npm test`（或 `npx vitest run`）
- [ ] 5.2 Lint：`npm run lint`
- [ ] 5.3 手动验收（验收标准逐条）：
  - abort 后输入框为空、无高亮；
  - 常驻 regenerate 按钮 → 点击生成 sibling branch → BranchSwitcher 切换对比；
  - aborted 消息有"已停止"标识；
  - 流式中 regenerate 不可触发；
  - edit / branch switch / retry 不回归。
- [ ] 5.4 手动确认旧 session（无新字段）打开无异常、正常降级。

## 回滚点

- 阶段 1-4 各自独立成 commit 前的暂存；阶段 1 的投影变更若发现兼容问题，可单独 revert（纯附加字段，低风险）。
