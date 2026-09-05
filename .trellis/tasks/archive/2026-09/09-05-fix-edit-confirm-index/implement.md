# Implement: Fix agent message edit confirm button index mismatch

## 前置状态

- 分支：`fix/litera-agent-runtime-message-confirm-button`
- 未提交文件：`package-lock.json`（npm install 产生的无关变更，commit 时不纳入或单独处理）、两个新测试文件。
- `src/agent/runtime/embedded-runtime.edit.test.ts` 当前断言旧行为，将在步骤 3 重写。

## 执行清单（按序）

### 1. pi-session：新增可见消息锚点遍历
- [ ] 在 `src/agent/sessions/pi-session.ts` 新增导出 `visibleMessageEntries(session): PiSessionEntry[]`。
  - 语义：与 `visibleMessages()` 一一对应——user 条目产出锚点；连续 assistant 条目序列只产出**第一个**作为锚点；`toolResult` 跳过；非 message 条目跳过。
  - 推荐重构 `visibleMessages()` 内部消费同一遍历（若改动可控），否则保持两者并存但用测试钉住不变量。
- [ ] 新增/更新单测（`src/agent/sessions/pi-session.test.ts` 或就近测试文件）：工具回合 + 多 user 场景下 `visibleMessageEntries` 与 `visibleMessages` 长度与 role 对齐。

### 2. runtime：编辑分支改用锚点遍历 + 本地错误透传
- [ ] `src/agent/runtime/embedded-runtime.ts` `prompt()` 编辑分支：`visibleMessageEntries(session)` 替换现有 `branch.filter(...)`；校验 `target.message.role === "user"`。
- [ ] 本地校验错误（"Edited message is not a visible user message"）不再被 `classifyPromptError` 映射为「模型请求失败」：在 catch 前识别本地错误直接透传（最小改动，不重构分类体系）。

### 3. 重写/更新回归测试
- [ ] 重写 `src/agent/runtime/embedded-runtime.edit.test.ts`：
  - 场景 A：含工具回合（assistant toolCall → toolResult → assistant text）的多回合会话，编辑 UI index 2 的第二问 → `session_rewound.messages` 为 `[user q1, assistant(合并), user q2 之前的内容...]`（即 q2 之前），回滚 leaf 正确，prompt 完成（`prompt_end`）。
  - 场景 B：同会话编辑 UI index 0 → 回滚到分支根（`parentId === null` 或快照条目）。
  - 场景 C：editIndex 指向 assistant 气泡（如 index 1）→ 抛出原始错误信息，而非「模型请求失败」。
- [ ] 保留 `src/components/chat/ChatPanel.edit-confirm.test.tsx`（已通过，直接入库）。

### 4. 全量验证
- [ ] `npm test -- --run`：全部通过（原有 627 用例 + 新增）。
- [ ] `npm run build`：类型检查 + 构建通过。

### 5. 收尾（Phase 3）
- [ ] 按 trellis 流程更新 spec（若 frontend/backend spec 有涉及消息索引/会话遍历的段落）。
- [ ] commit（英文 message，含两个测试文件；`package-lock.json` 的无关变更不纳入）。
- [ ] 运行 trellis-finish-work skill。

## 验证命令

```bash
npx vitest run src/agent/sessions/ src/agent/runtime/ src/components/chat/ChatPanel.edit-confirm.test.tsx
npm test -- --run
npm run build
```

## 回滚点

- 每个步骤独立可 revert；最终单 commit，revert 即回滚。

## 风险

- 重构 `visibleMessages()` 共享遍历时可能改变现有 UI 行为 → 用现有 627 用例 + 新不变量测试守护；若风险高退回"并存 + 不变量测试"方案。
