# Tune wheel paging to Readest sensitivity

## Goal

分页模式下，触控板轻扫或鼠标滚轮一格就能翻一页；同一次甩动的惯性不再连翻，也不会把下一次手势锁死。

## User Value

滚动翻页跟常见桌面阅读器一样灵敏，不必刻意用力或等很久才能再翻。

## Background / Confirmed Facts

- 用户反馈当前滚动翻页「不灵敏」。产品选择跟 Readest 同一套手势模型（不做 Foliate GTK 的 1:1 跟手 snap）。
- 现有算法在 `src/lib/reader-paging.ts`：`WHEEL_THRESHOLD = 80`，`WHEEL_COOLDOWN_MS = 280`。冷却期内每个 `wheel` 事件把 `cooldownUntil` 再延长 280ms。macOS 触控板惯性会把锁一直续到惯性停完再加 280ms。
- `src/components/ReaderView.tsx` 在宿主和章节 iframe `doc` 上听 `wheel`（`passive: false`），忽略 `ctrlKey`，取 `|deltaX|` / `|deltaY|` 较大轴，交给 `consumeWheelDelta`，再调 `prev` / `next`。
- 当前不读 `deltaMode`。`deltaMode === 1`（行）时单格 delta 常为 1–3，永远攒不到 80。
- Readest `createWheelGestureDetector`（`apps/readest-app/src/app/reader/utils/wheelGesture.ts`）：阈值 30px，停 200ms 算新手势；翻过一次后吞掉同手势惯性；`deltaMode` 1/2 分别按 40px/行、800px/页归一化。注释写明对齐 Apple Books。
- 点击分区、方向键、划词、不改 `flow="scrolled"`、不改 `src/foliate-js/` 仍有效。归档任务 `08-13-restore-reader-paging`。

## Requirements

### R1 手势模型对齐 Readest

- `consumeWheelDelta` 改为：累加 → 过阈值翻一页 → 同手势其余事件全部忽略 → 事件间隔超过空闲窗口后重置。
- 不要再用「冷却期内每个事件续期」的模型。

### R2 参数

- 阈值 **30**（归一化像素）。
- 空闲重置 **200ms**。
- `deltaMode === 1` 按 40px/行，`deltaMode === 2` 按 800px/页；`0` 或未知按像素。

### R3 绑定面不变

- 仍由 `ReaderView` 在宿主 + 章节 iframe 听 `wheel`。
- 忽略 `ctrlKey`。
- 下/右 → `next()`，上/左 → `prev()`。
- 点击左右 1/3、方向键、划词/链接保护、输入框/对话框里方向键不翻页，行为不变。

### R4 测试

- 更新 `src/lib/reader-paging.test.ts`：阈值 30、空闲重置、翻页后吞惯性、空闲后再翻、`deltaMode` 归一化。

## Acceptance Criteria

- [ ] 触控板轻扫（累加约 30px）就能翻一页，不必攒到 80px。
- [ ] 一次甩动及其惯性尾巴只翻一页。
- [ ] 惯性停约 200ms 后再滚，可以立刻翻下一页；不会被惯性事件无限续锁。
- [ ] 行模式鼠标滚轮一格（`deltaMode === 1`，delta 约 1）能翻一页。
- [ ] Ctrl/捏合缩放不翻页。
- [ ] 页边点击、方向键、划词、「问 agent」与改前一致。
- [ ] `npm test` 与 `npm run build` 通过。

## Out of Scope

- Foliate 式 1:1 跟手 + snap。
- 连续滚动手势按距离连翻多页。
- 空格、PageUp / PageDown。
- 恢复底栏翻页按钮。
- 改 `src/foliate-js/` 或把阅读模式改成 `scrolled`。
- 固定版式 EPUB 专项适配。

## Decisions

- **D1** 跟 Readest，不跟 Foliate GTK 1:1。
- **D2** 阈值 30、空闲 200ms、行/页 deltaMode 归一化，与 Readest 默认值一致。
- **D3** 轻量任务：只改 `reader-paging.ts`、其测试、以及 `ReaderView` 传入 `deltaMode` / 时间戳。

## Technical Notes

- `WheelPagingState` 从 `{ accumulated, cooldownUntil }` 换成 `{ accumulated, lastTime, flipped }`。
- 初始 `lastTime` 用 `0`：第一次事件与 0 的间隔必大于 200ms，会重置，行为正确。
- 优先用 `WheelEvent.timeStamp`；测试继续显式传 `now`。
