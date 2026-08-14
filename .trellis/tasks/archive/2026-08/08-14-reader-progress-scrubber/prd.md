# Reader progress scrubber

## Parent

`08-14-reader-annotate-and-progress`

## Goal

阅读页顶栏下方恢复永远可见的进度细条，并让它可点可拖，跳到全书任意位置。

## User Value

读者不用只靠目录或一页页翻，就能看到读到哪、并直接跳过去。

## Background / Confirmed Facts

- 父任务决定覆盖 `08-13-remove-reader-progress-bar`：常驻细条，可跳转。
- 删条前：`ReaderProgressBar` 在顶栏正下方，细条 + `chapterLabel · {pct}%`，不可点。`chapterLabel = progress.label ?? \`Chapter ${progress.index + 1}\``。
- `progress` 仍在 `App.tsx`；`ReaderViewHandle.goToFraction` 已有。
- 现有 spec 写着「不要加阅读页进度条」。本任务实现时必须改掉那两处约定。
- 书库 `BookCard` 进度不在本任务。

## Requirements

- 阅读页顶栏正下方永远显示进度细条：章节名、百分比、填充。
- 点击或拖动细条，调用 `goToFraction`；跳转后条上数字与正文一致。
- 翻页、目录跳转后细条跟随（现有 `onRelocate`）。
- 百分比不进顶栏按钮区。
- 不改书库卡片。不改 sidecar。不改标注。

## Acceptance Criteria

- [ ] 打开书后，顶栏下方有常驻细条，显示章节与百分比。
- [ ] 点击细条某处，正文跳到对应全书进度，条上百分比一致。
- [ ] 拖动细条松手后，正文停在对应进度。
- [ ] 键盘/滚轮/点击翻页后，细条更新。
- [ ] 百分比不在顶栏图标区；书库卡片进度不变。
- [ ] `component-guidelines.md` 与 `state-management.md` 不再禁止这条阅读页进度 chrome。
- [ ] `npm test` + `npm run build` 通过。

## Out of Scope

- 书签、高亮、标注抽屉
- 悬停才出现的条、顶栏弹出滑块
- 剩余阅读时间、页码
- 书库卡片进度

## Dependencies

无。可先于标注 child 实现。
