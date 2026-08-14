# Fix settings dialog to a fixed size

## Goal

一般设置弹窗（`SettingsDialog`）使用固定宽高。切换「排版 / 外观 / AI」时框本身不再跟着内容变矮或变高。

## Background

`SettingsDialog` 的 `DialogContent` 当前是 `flex max-h-[85vh] … sm:max-w-3xl`（`src/components/settings/SettingsDialog.tsx:201`）。宽度只有上限，高度只有 `max-h`，实际尺寸由当前分区内容决定。排版区最长（7 条滑条 + 字体/对齐），外观区很短，切分类时弹窗会跳。

底层 shadcn `DialogContent` 默认 `w-full max-w-[calc(100%-2rem)] sm:max-w-lg`。设置弹窗只覆盖了 `sm:max-w-3xl`。聊天里的 `AgentConfigDialog` 是另一块表面，不在本次范围。

书库齿轮和阅读页 Aa 仍打开同一个 `SettingsDialog`。分区、控件、作用域、持久化已在 `08-13-settings-as-dialog` 定下来，本次只改壳尺寸。

## Requirements

### R1 弹窗宽高不随分区变化

- `SettingsDialog` 的框在「排版」「外观」「AI」之间切换时，宽和高都保持不变。
- 内容比框矮时，右侧内容区留白；内容比框高时，右侧内容区滚动。左侧分类栏不跟着内容区变高变矮。

### R2 尺寸取值

- 宽度锁成当前已在用的 `3xl`（768px），不要再按内容收缩。
- 高度用一个常量，按最长分区（排版）在典型桌面窗口里能完整放下来定，不要为了紧凑而让排版区在常见窗口里新增滚动条。
- 窗口不够大时仍受视口约束：宽度不超过 `calc(100% - 2rem)`，高度不超过 `85vh`。此时内部滚动，而不是把框顶出窗口。

### R3 行为与范围不变

- 不改分区、控件、文案、作用域、关闭方式。
- 不改 `AgentConfigDialog`、聊天齿轮入口。
- 不改偏好 / 每书设置 / sidecar。

## Acceptance Criteria

- [ ] 打开设置后，在排版、外观、AI 之间切换，弹窗外框宽高不变。
- [ ] 宽为 768px（窗口更窄时按 `calc(100% - 2rem)` 收）。
- [ ] 典型桌面窗口（高度 ≥ 约 800px）里，排版区不必滚动就能看到全部控件。
- [ ] 窗口很矮时，框不超过 `85vh`，内容在右侧滚动。
- [ ] 外观区控件少，框不因此变矮。
- [ ] 现有设置测试仍过；`npm test` + `npm run build` 通过。

## Out of Scope

- 不改 `AgentConfigDialog`。
- 不改排版项、精调范围、主题/语言/AI 表单。
- 不把设置改回全屏页，也不改成锚在按钮旁的浮层。
- 不做设置页正文预览区。
- 不改持久化协议、schema、sidecar。
