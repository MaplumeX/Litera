# Implementation Plan

## Dependencies

- `08-12-fix-library-persistence-safety` 已完成并提供可信 book/session 根。
- `08-12-fix-sidecar-packaging-ipc` 已完成并提供 externalBin、shell transport 和新 open flow。

## Checklist

- [x] 1. 定义唯一 Rust serde/TypeScript protocol envelope、事件判别联合、ID/seq/size 验证和 fixture round-trip 测试。
- [x] 2. 将 sidecar stdin 入口重构为可测试 dispatcher，状态改变串行，abort 旁路，prompt 受跟踪且禁止重入。
- [x] 3. 切书时 abort 旧 prompt、清 session、使用 generation 防止旧 load 覆盖；首个 prompt 自动建会话。
- [x] 4. 提取 BookWorker RPC，使 EPUB/FTS 重任务不阻塞 main sidecar 控制循环和 ping/abort。
- [x] 5. 工具事件增加 toolCallId；所有 event/error 带正确的 book/session/prompt/request 关联。
- [x] 6. 实现 Rust supervisor actor、有界命令 channel、stdout line framer、typed decode 和 snapshot 先更新后 emit。
- [x] 7. 实现 terminated 检测、shutdown/reap、有界自动重启、book/session replay 和手动 restart 命令。
- [x] 8. 删除旧 `Mutex<SidecarState>`、同步 write/flush、分散 `forward_sidecar_event` 和多个旧 Tauri event 名称。
- [x] 9. 新建 shared Agent types、纯 reducer 和 `useAgentBridge`；监听后 snapshot 水合、version/ID 过滤、迟到 unlisten 清理。
- [x] 10. 更新 ChatPanel session/prompt/abort/错误 UI，返回书库时 close/abort，活动 prompt 时限制危险会话操作。
- [x] 11. 增加 Node 状态机竞态、Rust supervisor 纯状态/边界测试、React StrictMode hook/reducer 和跨层 fixture 测试。
- [x] 12. 运行大书加载期间控制响应、进程恢复状态、A/B 快速切书、空 PATH smoke 和监听计数集成测试。

## Required Race Tests

- A 有 session、B 无 session：B prompt 自动建 B session，不写 A。
- open A/load slow → open B/load fast：只接受 B ready，worker 中 A 结果被 generation 丢弃。
- list A 与 list B 反序返回：React 只应用当前 B 的 response。
- prompt → switch/delete/book close：旧 prompt 有界 abort，旧 delta/end 不改变新状态。
- sidecar 在 prompt 中退出：UI 收到 interrupted，supervisor 重启并恢复 book/session，不重放 prompt。
- StrictMode setup/cleanup/setup 与 listen Promise 迟到：最终只有一个 listener，卸载后为零。
- unrelated list/error 事件不清除匹配 prompt 的 streaming 状态。
- 并发 tool call end 通过 toolCallId 更新正确卡片。

## Validation Commands

```bash
npm --prefix sidecar run build
npm --prefix sidecar test
npm test -- --run
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml sidecar
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run smoke:sidecar
npm run tauri build -- --no-bundle
```

## Risky Areas and Rollback

- `src-tauri/src/lib.rs` 与新 supervisor/protocol 模块、`sidecar/index.ts`/BookWorker、`ChatPanel.tsx`/agent hook/types。
- 先以 fixture 固定新协议，再改三端；任何一端失败时整体回到旧协议提交，不做兼容双发。
- 重启 replay 在基础状态机通过后单独提交；若 replay 不稳定，可回滚为 unavailable + 手动 restart，但不能静默使用过期状态。
- 本子任务完成后建立 RP3，交回父任务做全量集成。
