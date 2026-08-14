# 执行计划:agent 会话摘要压缩机制

## 前置

- [x] 研究 pi coding agent 压缩设计(compaction.js / agent-session.js / session-manager.js)
- [x] 确认依赖可用:pi-ai 导出 `isContextOverflow` / `isRecoverableLength` / `completeSimple`;assistant 消息携带真实 usage;faux 测试可自定义 usage
- [x] 确认读取端已支持 compaction(pi-session.ts 无需改动)

## 实施步骤

### 1. 新增 `src/agent/compaction/compaction.ts`

纯函数 + 摘要生成,按 design.md 模块设计:

- [ ] 常量 `DEFAULT_COMPACTION_SETTINGS`(reserveTokens: 16384, keepRecentTokens: 20000)
- [ ] `estimateTokens(message)` — chars/4,各角色分块统计
- [ ] `estimateContextTokens(messages)` — 最后有效 usage + 补估
- [ ] `shouldCompact(contextTokens, contextWindow, settings)`
- [ ] `findCutPoint(entries, startIndex, endIndex, keepRecentTokens)` — 切割点不可为 toolResult
- [ ] `prepareCompaction(entries, settings)` — 边界定位 + tokensBefore + 收集待摘要消息
- [ ] `serializeConversation(messages)` — 纯文本序列化,tool result 截断
- [ ] `generateSummary(...)` — 结构化摘要 prompt + UPDATE 合并 + 独立请求(cacheRetention none + 新 sessionId)

### 2. 新增 `src/agent/compaction/compaction.test.ts`

- [ ] `estimateTokens` 各角色统计
- [ ] `estimateContextTokens` 优先 usage、回退估算
- [ ] `shouldCompact` 阈值边界
- [ ] `findCutPoint` 切割点选择、跳过 toolResult、无切割点时默认
- [ ] `prepareCompaction` 边界定位、previousSummary、无可压缩内容返回 undefined
- [ ] `serializeConversation` 格式与截断
- [ ] `generateSummary` 用 faux core 验证调用(可选,若 faux 支持自定义 usage)

### 3. 修改 `src/agent/runtime/embedded-runtime.ts`

- [ ] `ensureAgent()`: `windowCompleteTurns(piContextMessages(session), 12)` → `piContextMessages(session)`(放宽硬截断)
- [ ] 新增 `maybeCompact(agent, session, bookId): Promise<boolean>`:
  - 防抖(最后有效 usage 时间戳 vs 最新 compaction 时间戳)
  - token 计算(usage 优先,估算回退)
  - 阈值 + 溢出兜底(`isContextOverflow`)
  - `prepareCompaction` → `generateSummary` → 持久化 compaction 条目 → `agent.state.messages = piContextMessages(session)` 重建
  - 失败静默降级
- [ ] `prompt()` 流程:ensureAgent 后 pre-prompt 检查;persist 完成后 post-prompt 检查(均在 finally 清空 promptId 之前)

### 4. 更新 `src/agent/runtime/embedded-runtime.test.ts`

- [ ] 长会话触发压缩:构造超阈值 usage 的 assistant 消息,验证 compaction 条目写入 + 上下文重建
- [ ] 短会话不触发
- [ ] 压缩后防抖(不立即再触发)
- [ ] 压缩失败静默降级(不阻塞 prompt_end)
- [ ] 现有测试保持通过(注意:放宽 12 回合后,现有测试若依赖窗口截断需检查)

## 验证命令

```bash
cd /home/maplume/projects/Litera
npx vitest run src/agent/compaction src/agent/runtime src/agent/sessions   # 单元测试
npx tsc --noEmit                                                           # 类型检查
npm run build                                                              # 构建
```

## 审查门

- [ ] compaction.ts 纯函数全部有测试
- [ ] embedded-runtime 集成测试覆盖触发/防抖/降级
- [ ] 现有测试无回归
- [ ] tsc 无错误

## 回滚点

- 压缩逻辑集中在 `maybeCompact` + compaction.ts,可整体移除
- `ensureAgent` 一行改动可还原为 `windowCompleteTurns(..., 12)`
- compaction 条目对读取端透明,旧会话不受影响
