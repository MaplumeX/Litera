# Remove reader progress bar

## Goal

阅读页顶栏下方不再单独占一行显示章节名和百分比。打开书后，顶栏下面直接是正文。

## User Value

少一条永远在场的 chrome，阅读页更接近「正文为中心」。进度仍写回书库，书架上还能看出读到哪。

## Background / Confirmed Facts

- 阅读页 `ReaderProgressBar` 在 `src/App.tsx:42-63`，挂在顶栏正下方（`:572`）。展示全书 `fraction` 的细条 + `chapterLabel · {pct}%`。`chapterLabel` 由 `progress.label ?? \`Chapter ${progress.index + 1}\`` 推出（`:456`）。不可点击。
- `progress` state（`:91-94`）不只服务这条 UI：`progress.index` 传给 `ChatPanel` 的 `currentChapterIndex`（`:627`）；`handleRelocate` 仍用 `fraction` 走 `persistFraction`（`:324-334`），书库卡片靠 `BookRecord.lastFraction` 显示进度。
- 书库进度在 `BookCard.tsx`：封面底细条 + 角标百分比。从未打开过的书（无 `lastFraction`）不显示 0%。本任务不改。
- 没有测试断言阅读页进度条文案。`BookCard.test.tsx` 只覆盖卡片百分比。
- 产品决定：阅读页删条，不换成发丝线，也不把百分比塞回顶栏。

## Requirements

### R1 阅读页去掉通栏进度条

- 删除 `ReaderProgressBar` 组件及其在阅读页的渲染。
- 顶栏（返回、书名、目录/字体/对话）下方直接是阅读区，中间不再有 `h-5` 进度行。
- 不新增任何替代进度 UI（细线、顶栏百分比、底部页码条等）。

### R2 阅读位置与对话章节上下文保留

- `onRelocate` 仍更新章节 index 与 `fraction`。
- `ChatPanel` 仍收到当前 `currentChapterIndex`。
- `lastFraction` 仍按现有 debounce 写回；回书库、再打开、卡片进度行为不变。

### R3 书库进度不动

- `BookCard` 的细条和百分比角标保持原样。

## Acceptance Criteria

- [ ] 阅读页顶栏正下方没有章节名、百分比或进度细条。
- [ ] 阅读页顶栏与正文之间没有额外的通栏进度行。
- [ ] 翻页后对话仍使用当前章节 index（发消息/问 agent 不因删条而丢章节上下文）。
- [ ] 阅读位置仍会保存；回书库后该卡片仍显示原来的进度。
- [ ] 书库卡片进度展示与本任务前一致。
- [ ] `npm test` + `npm run build` 通过。

## Out of Scope

- 书库卡片进度的呈现改动（去角标、改成书名下行等）。
- 进度条点击跳转、scrubber、自动隐藏顶栏。
- 用发丝线或顶栏数字替换阅读页进度条。
- sidecar、后端、`update_reading_state` 协议、阅读位置恢复算法。

## Technical Notes

- 轻量任务：只改 `src/App.tsx`。删组件、删调用、删仅服务该条的 `chapterLabel`。
- 不要删 `progress` state 或 `handleRelocate` 里的 `setProgress`——`progress.index` 仍要给 `ChatPanel`。
- `progress.label` 删条后若不再被读取，可随组件一起去掉消费，不必为它保留派生变量。
- 当前分支：`feat/progress-bar-presentation`。
