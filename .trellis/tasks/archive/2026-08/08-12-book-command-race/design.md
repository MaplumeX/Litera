# Design — Fix Command does not match the current book race

## 1. 问题定位(确认的根因)

报错来自 `sidecar/index.ts` `requireCurrentBook()`:

```ts
function requireCurrentBook(bookId: string, ready = true): CurrentBook {
  if (!currentBook || currentBook.id !== bookId) throw new Error("Command does not match the current book");
  if (ready && currentBook.phase !== "ready") throw new Error("Book is still loading");
  return currentBook;
}
```

**主触发点(路径 A):** `src/lib/use-agent-bridge.ts` 的 `book_changed` effect(约 73-82 行)在 `bookId` 变化时**无条件**调用 `listSessions()`:

```ts
useEffect(() => {
  dispatch({ type: "book_changed", bookId: bookId || null });
  if (subscribed && bookId) {
    void invoke<AgentSnapshot>("get_agent_snapshot")...
    void listSessions().catch(...);   // ← 早于 sidecar 处理 OpenBook
  }
}, [bookId, listSessions, subscribed]);
```

时序:`handleOpenBook` 在 `open_book_bytes` resolve 后 `setFileData({ bookId: B })`。此时 Rust 的 `send_open_book` 只保证 `OpenBook{B}` 写入 child-writer queue,**不保证 sidecar 的 `SerialDispatcher` 已消费它**并执行 `handleOpenBook` 设置 `currentBook = B`。React 重渲染 → effect → `listSessions()` 发 `list_sessions { bookId: B }` 抵达 sidecar 时,`currentBook` 可能仍为 `null`(首次)或 `A`(切书),`requireCurrentBook(B, false)` 抛错。

`onEvent` 已有 `book_ready → listSessions()` 分支(73 行附近),所以 `book_changed` 里的 `listSessions()` 是**冗余且竞态的**。

**次触发点(路径 B):** `onSnapshot` 里 `switchSession(snapshot.sessionId)`(63-67 行)条件含 `status === "bookReady"`。正常打开时 snapshot 通常已是 loadingBook,不触发;但**重启重放**后 snapshot 可能携带 `bookReady` + 旧 sessionId,而重放 `OpenBook` 的 sidecar 端 `currentBook` 尚未就绪 → 命中。不过当前 snapshot 的 bookReady 在重放中需 Rust 侧先置,需进一步看 Rust snapshot 时机(见 §6 待验证)。

**非根因但需保持:** sidecar `requireCurrentBook` 的严格校验是 spec 要求(tauri-commands.md "Prompt/book correlation does not match → advance version but do not mutate"),**不放宽**。

## 2. 修复策略

核心原则:**前端只以 `book_ready` 事件作为"可以向 sidecar 发书内命令"的绿灯**,不再以 React `bookId` state 变化作为发命令的触发。

### 2.1 前端改动(`src/lib/use-agent-bridge.ts`)

**(a) `book_changed` effect:移除 `listSessions()` 与主动 snapshot hydrate 的"发命令"部分,仅 dispatch `book_changed`。**

`book_changed` reducer action 已将状态置为 `loadingBook`(或保留 unavailable),`listSessions` 改由后续 `book_ready` 事件驱动。snapshot hydrate 保留(dispatch 是纯函数,不发命令),但 hydrate 内若 `status === bookReady` 的 `switchSession` 也要走统一门控(见 (c))。

```ts
useEffect(() => {
  dispatch({ type: "book_changed", bookId: bookId || null });
  // 不在此发任何 invoke 命令;等 book_ready 事件驱动
}, [bookId]);
```

**(b) `onEvent` 的 `book_ready` 分支:保持并增强为唯一的 session 列表刷新 + session 恢复入口。**

```ts
} else if (event.type === "book_ready") {
  void listSessions().catch(...);
  // 若有 pendingRestoreSessionId(来自 snapshot hydrate),在此 switch
}
```

**(c) `onSnapshot` 的 `switchSession`:仅在 sidecar 已 bookReady 时执行,否则记录"待恢复 sessionId"等 `book_ready` 事件触发。**

引入 ref `pendingRestoreSessionIdRef`。snapshot hydrate 时:
- 若 `snapshot.bookId === currentBookId && snapshot.status === "bookReady" && snapshot.sessionId` → 立即 `switchSession`。
- 否则若 `snapshot.bookId === currentBookId && snapshot.sessionId` → 存入 `pendingRestoreSessionIdRef`,`book_ready` 事件到来时消费。

这覆盖重启重放路径:重放期间 snapshot 为 loadingBook,sessionId 存 pending;重放 `book_ready` 后从 pending 恢复。

**(d) `agent_prompt` 调用门控:** `prompt` useCallback 内,若 `state.status !== "bookReady"`,拒绝/排队。当前 `ChatPanel` 已用 `bookReady = state.status === "bookReady" || state.status === "prompting"` 禁用发送按钮,但 `prompt()` 本身无防御。加一道显式校验返回 rejected promise,避免任何路径在 loading 期发出。

### 2.2 Reducer 改动(`src/lib/agent-reducer.ts`)

`book_changed` action 当前:
```ts
status: action.bookId ? "loadingBook" : (state.status === "unavailable" ? "unavailable" : "ready"),
```
保持不变。这正确表达了"未收到 book_ready 前处于 loadingBook"。

无需新增 action 类型;`book_ready` 事件已置 `bookReady`。

### 2.3 sidecar 改动

**不放宽 `requireCurrentBook`。** 但改进错误信息可观测性:当 `currentBook` 为 null 或 id 不匹配时,在 error 事件里附带当前 `currentBook?.id ?? null`,便于诊断。这是可选增强,不改变协议契约。

### 2.4 不做的事

- 不在前端轮询 `get_agent_snapshot` 等 ready。
- 不加多个事件监听。
- 不在 `book_changed` effect 里 sleep/重试。
- 不改 sidecar 把 `list_sessions` 改成不依赖 `currentBook`(它需要 `currentBook.sessionsDir`)。
- 不改 `open_book_bytes` 的返回时机(已正确:writer-queue acceptance 先于字节返回)。

## 3. 数据流(修复后)

```
用户点书 B
  → handleOpenBook: open_book_bytes(B) await [OpenBook{B} 入 sidecar writer queue]
  → setFileData({ bookId: B }) → React rerender
  → useAgentBridge effect: dispatch({ book_changed, B })   [不发命令]
  → sidecar SerialDispatcher 消费 OpenBook{B}: currentBook=B{loading}
  → bookWorkers.load 异步完成 → currentBook.phase=ready → 发 book_ready{B}
  → 前端 onEvent(book_ready{B}): listSessions(B)   [现在 currentBook.id===B ✓]
  → sessions_list 回来 → reducer 填充 → ChatPanel auto-switch effect 选中首个 session
  → (若 snapshot 曾记录 pendingRestoreSessionId) book_ready 时 switchSession(待恢复)
```

重启重放:
```
sidecr 崩溃 → Rust handle_process_ended → recovering=true
  → 重启进程 → Ready → 重放 OpenBook{B} → sidecar currentBook=B{loading}
  → 前端 onSnapshot(hydrate): status=loadingBook → 存 pendingRestoreSessionId
  → sidecar book_ready{B} → 前端 onEvent: listSessions + switchSession(pending) ✓
```

## 4. 影响面与兼容性

- **ChatPanel 自动选 session 的 effect**(`ChatPanel.tsx` 约 130-140 行)依赖 `state.sessions.length`,需 `listSessions` 填充。修复后 `listSessions` 由 `book_ready` 驱动,该 effect 仍能在 `sessions_list` 后触发,行为不变。
- **乐观 `session_created`**:不变。`session_created` 后不调 `listSessions()`(已如此),`book_ready` 触发的 `listSessions` 不会在 `session_created` 之后立即触发(不同事件)。
- **`prompt_end`/`prompt_aborted` 的 `switchSession`+`listSessions`**:不变,此时必然已 bookReady。
- **`handleBackToLibrary` 的 `close_book`**:不依赖 `book_ready` 门控,保持现状(close 用 `bookId?` 可选匹配)。

## 5. 测试设计

### 5.1 前端单测(`src/lib/agent-reducer.test.ts` 扩展 + 新 `use-agent-bridge` 行为测试)

reducer 纯函数测试无法测 invoke 副作用,需对 `useAgentBridge` 做 hook 测试(vitest + mock `invoke`/`listen`)。现有 `agent-subscription.test.ts` 已有 listen mock 范式可参考。

新增:
- **T1 book_changed 不发命令**:mock `invoke`,触发 `bookId` 变化,断言 `list_sessions`/`switch_session` 未被调用,`get_agent_snapshot` 仍被调用(只 dispatch hydrate)。
- **T2 book_ready 触发 listSessions**:触发 `book_ready` 事件,断言 `list_sessions` invoke 调用一次。
- **T3 snapshot pendingRestore**:hydrate 时 status=loadingBook 且有 sessionId,断言 `switch_session` 未立即调用;随后 `book_ready` 事件到达,断言 `switch_session(pendingId)` 调用。
- **T4 prompt 在非 bookReady 拒绝**:`state.status="loadingBook"` 时调 `prompt()`,断言 rejected 且 `agent_prompt` 未调用。
- **T5 乐观 session_created 不被覆盖**:保持现有行为,`session_created` 后无 `listSessions` 调用。

### 5.2 现有测试回归

- `agent-reducer.test.ts` 全绿。
- `agent-subscription.test.ts` 全绿(确认 listen/cleanup 次序不破)。

### 5.3 手动/集成验证(AC1-AC3)

- 慢机模拟:在 sidecar `bookWorkers.load` 前人为 delay,连续 A→B 打开,观察无报错且 B session 列表正常。
- sidecar 重启:运行中 kill sidecar 进程,观察前端在重放 `book_ready` 前不发命令、重放后恢复 session。
- 首次进入书籍:session 列表空 → 自动新建/选中,行为与现状一致。

## 6. 待验证 / 风险

- **Rust snapshot 在重放期间的 status 值**:`handle_process_ended` 置 `AgentStatus::Restarting`,重放 `OpenBook` 后 `BookLoading` → `BookReady`。前端 `onSnapshot` 收到的可能是 `restarting`/`loadingBook`。需确认 reducer `hydrate` 在 `restarting` 状态下不会误判 bookReady 触发 switchSession。当前 `hydrate` 用 `snapshot.status === "bookReady"` 判断,Rust 重放期间不会发 bookReady(直到 sidecar book_ready 事件),所以安全。实现时复核。
- **`open_book_bytes` 串行化与 effect 时序**:`handleOpenBook` 的 `openBookControllerRef` 保证 UI 层 A/B 串行,但 `setFileData` 到 effect 触发是同步 React 流程,不受串行化保护。修复后 effect 不发命令,此风险消除。
- **`subscribed` 依赖移除**:`book_changed` effect 原依赖 `[bookId, listSessions, subscribed]`,移除命令后依赖可简化为 `[bookId]`。注意 `listSessions`/`switchSession` 的 useCallback 闭包 `bookIdRef.current` 仍是最新值,不受影响。

## 7. 复杂度判定

需 `design.md`(本文件)+ `implement.md`。理由:跨前端时序重构 + 跨端时序测试 + 涉及 reducer/bridge 行为变更,非纯局部修改。