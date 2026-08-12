# Implement — Fix Command does not match the current book race

## 执行清单

按顺序执行,每步后跑对应验证。

### Phase A:前端 `use-agent-bridge.ts` 改造

- [ ] A1. 移除 `book_changed` effect 里的 `listSessions()` 与 `get_agent_snapshot` invoke 调用,仅保留 `dispatch({ type: "book_changed", bookId })`。依赖数组简化为 `[bookId]`。
  - 文件:`src/lib/use-agent-bridge.ts` 约 73-82 行。
  - 验证:`npm test -- agent-reducer` 保持绿(无 bridge 测试新增前先确保 reducer 不破)。
- [ ] A2. 引入 `pendingRestoreSessionIdRef = useRef<string | null>(null)`。
- [ ] A3. 改 `onSnapshot`:snapshot `bookId === currentBookId` 时:
  - `status === "bookReady" && sessionId` → 立即 `switchSession(sessionId)`(保持现状)。
  - 否则 `sessionId` 存入 `pendingRestoreSessionIdRef.current`。
- [ ] A4. 改 `onEvent` 的 `book_ready` 分支:在现有 `listSessions()` 之后,检查 `pendingRestoreSessionIdRef.current`,非空则 `switchSession(它)` 并清空 ref。
- [ ] A5. 改 `prompt` useCallback:开头加 `if (state.status !== "bookReady") throw new Error("Book is not ready")`。注意 `state` 需加入依赖数组(当前未依赖;改为读 `state.status`)。为避免 `prompt` identity 频繁变化,可用 `stateRef` 模式:`const statusRef = useRef(state.status); statusRef.current = state.status;` 在 callback 内读 ref。
  - 验证:ChatPanel `handleSend` 已有 `bookReady` 守卫,新增的是 bridge 层防御,行为一致。

### Phase B:测试

- [ ] B1. 新增 `src/lib/use-agent-bridge.test.ts`(若不存在):用 vitest mock `@tauri-apps/api/core` `invoke` 与 `@tauri-apps/api/event` `listen`。参考 `agent-subscription.test.ts` 的 listen mock 范式。
  - T1: `bookId` 变化不触发 `list_sessions`/`switch_session` invoke。
  - T2: `book_ready` 事件触发 `list_sessions` 一次。
  - T3: hydrate loadingBook + sessionId → `switch_session` 不立即调;`book_ready` 后调 `switch_session(pending)`。
  - T4: `state.status="loadingBook"` 调 `prompt()` reject,`agent_prompt` 未调用。
  - T5: `session_created` 事件不触发 `list_sessions`。
- [ ] B2. 扩展 `src/lib/agent-reducer.test.ts`:补 `book_changed` 后 `book_ready` 状态流转断言(确保 reducer 行为未变)。
- [ ] B3. 跑 `npm test` 全绿。

### Phase C:手动/集成验证

- [ ] C1. `npm run dev` + `npm run build:sidecar`,慢机模拟(可临时在 sidecar `handleOpenBook` 的 `bookWorkers.load` 前加 `await delay(500)` 验证后移除),连续 A→B 打开,无报错。
- [ ] C2. 运行中 `kill` sidecar 进程,观察前端控制台无 `Command does not match the current book`;重放后 session 恢复。
- [ ] C3. 首次进入书籍,session 列表空时自动新建/选中首个,行为正常。

### Phase D:收尾

- [ ] D1. 移除临时 delay(若 C1 加了)。
- [ ] D2. 更新 spec:若 `hook-guidelines.md`/`state-management.md` 描述的 `book_changed` effect 行为需修订(原描述"bookId 变化触发 listSessions"将不再准确),按 trellis-update-spec 流程更新。
- [ ] D3. `task.py start` 之后的实现完成,进入 Phase 3 (finish-work)。

## 验证命令

```bash
npm test                                    # 前端全量
npm test -- use-agent-bridge                # 新增 bridge 测试
npm test -- agent-reducer                   # reducer 回归
npm run build:sidecar && npm run smoke:sidecar  # sidecar 构建+冒烟
npm run dev                                 # 手动验证
```

## Review Gates

- A 阶段改完跑 `npm test -- agent-reducer` 必须绿,再进 B。
- B 阶段新增测试全绿后才进 C 手动验证。
- C 阶段确认无 `Command does not match the current book` 后才 commit。

## Rollback Points

- A1-A4 是 `use-agent-bridge.ts` 单文件改动,git revert 即可回滚。
- A5(prompt 门控)若引入 ChatPanel 行为异常,单独 revert 该 commit。
- B 阶段测试失败不阻塞主代码,先修测试再合。