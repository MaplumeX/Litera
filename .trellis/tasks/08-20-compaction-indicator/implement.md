# Implement: 压缩指示

## 执行清单

1. **types**：`src/types/agent.ts` — AgentEvent 联合类型新增 `compaction_started` / `compaction_completed` / `compaction_failed` 三个变体（均用 PromptCorrelation）
2. **i18n**：`src/locales/zh-CN.ts` + `src/locales/en.ts` — 新增 `chat.compacting` 和 `chat.compacted` 键
3. **runtime**：`src/agent/runtime/embedded-runtime.ts` — `maybeCompact` 拆三阶段 emit
   - prepareCompaction 成功后 emit `compaction_started`
   - generateSummary + append 成功后 emit `compaction_completed`
   - catch 分支 emit `compaction_failed`（再 return false）
4. **state**：`src/lib/agent-reducer.ts` — AgentState 加 `compaction` 字段；reducer 处理三个新事件；`session_switched`/`session_rewound` 清除
5. **component**：新建 `src/components/chat/CompactionChip.tsx` — 居中 chip，compacting/compacted 两态
6. **render**：`src/components/chat/ChatPanel.tsx` — 消息流底部、messagesEndRef 前渲染 chip
7. **测试**：
   - `src/lib/agent-reducer.test.ts`（若存在）— 验证 compaction 状态转换
   - `src/agent/runtime/embedded-runtime.test.ts` — 验证 emit 调用
   - `src/components/chat/ChatPanel.test.tsx` — 验证 chip 渲染

## 验证命令

```bash
npm test -- --run   # 全量测试
npm run build       # tsc 类型检查 + 构建
```

## 回滚点

- 改动均为增量（新事件类型、新字段、新组件），不修改现有逻辑
- 出问题可单独 revert chip 渲染行（ChatPanel 第 6 步）即可恢复原行为

## 风险文件

- `src/agent/runtime/embedded-runtime.ts` — maybeCompact 逻辑改动需小心保持原有 return 值和错误吞咽行为
- `src/lib/agent-reducer.ts` — switch 穷尽性