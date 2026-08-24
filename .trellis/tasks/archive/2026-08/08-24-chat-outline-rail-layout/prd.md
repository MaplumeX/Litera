# Fix Agent chat outline rail layout

## Goal

让 Agent 工作区对话刻度轨看起来像 Paseo：条目是中间一簇分开的短横，hover 只鼓起附近几条；轨出现时消息列左缘让出位置，助手气泡和头像不再被 36px 刻度挡住。

## Background

- 工作区 `ChatOutlineRail` 来自 `08-23-chatgpt-style-chat-toc`，意图对齐 Paseo `packages/app/src/agent-stream/chat-outline/rail.web.tsx`。
- 用户反馈两条可见缺陷：刻度不像 Paseo 那样一条条分开；hover 时几乎所有刻度都在变；消息没有给轨留空。
- 当前轨是叠在消息列上的，不占布局宽度。Paseo 能这样叠，是因为宽面板 + 正文 `max-width` 居中，左边自带 gutter。Litera 工作区是和书分栏的窄列，没有这条 gutter。

## Confirmed facts

- `ChatOutlineRail` 的 `<nav>` 为 `absolute top-[10%] bottom-[10%] left-0 z-10 flex w-9 flex-col`（`src/components/chat/ChatOutlineRail.tsx:86`）。slot 使用 `flex-1 items-stretch`（同文件 `:109`），会把少量提问均分整条轨高。
- Dock 放大按 **index 距离** 计算，半径 3（同文件 `MAGNIFY_RADIUS` / `tickMagnification`）。slot 被拉高后，视觉上隔很远的刻度仍是邻居，hover 看起来像全部在动。颜色仍只有当前条 `bg-foreground`。
- Paseo slot 是 `flexBasis: 8`、`flexShrink: 1`、**不 grow**，轨 `justifyContent: "center"`。少量提问挤在中间；长对话才压缩。
- 消息滚动区是 `h-full space-y-4 overflow-y-auto p-3`（`src/components/chat/ChatPanel.tsx:479`）。助手消息左对齐带头像（`AssistantMessage.tsx:56`）。轨 36px 叠在 `p-3`（12px）之上，会挡住头像和正文左缘。
- 轨仅 `variant="workspace"` 且用户提问 ≥ 2 条时挂载。`variant="docked"` 没有轨。输入框和标题栏不在轨的覆盖范围内。
- 现有 spec（`.trellis/spec/frontend/component-guidelines.md` 「chat user-message outline is a workspace rail」）写了 “Do not steal layout width”。本任务要改掉这条：轨出现时必须让出左缘。

## Requirements

### R1. 刻度槽几何对齐 Paseo

- Slot 默认高度 8px（Tailwind `basis-2`），`flex-grow: 0`，`flex-shrink: 1`。禁止 `flex-1` 均分轨高。
- 轨纵向 `justify-center`，少量提问挤在中间，刻度之间有可见空隙。
- 长对话 slot 可被压缩到低于 8px，仍铺满 10%–90% 轨高。
- 当前项仍更长/更亮；dock 放大半径与公式保持不变；`prefers-reduced-motion` 仍关闭放大。
- Hover/焦点预览、点击跳转、会话/书籍 remount 行为不变。

### R2. 轨出现时让出左缘

- 工作区且轨挂载时，消息滚动区左侧内边距 = 轨宽 36px + 原有 12px 间隙（合计 48px，`pl-12`），上/右/下仍为 12px。
- 轨仍 `absolute` 叠在该 gutter 里（`left-0`、`w-9`、`top/bottom 10%`），不改成独立 flex 列，也不遮 `ChatInput` 或标题栏。
- 空会话或仅 1 条用户提问时不留这条 gutter，滚动区回到 `p-3`。
- `variant="docked"` 的滚动区内边距不变。

## Acceptance Criteria

- [ ] AC1. 工作区 ≥2 条用户提问时，刻度槽不是 `flex-1`；少条目时刻度簇在轨中部，彼此分开，而不是均分整列高度。（R1）
- [ ] AC2. Hover/焦点一条刻度后，预览仍只出现在该条右侧；邻近条可按半径 3 放大，远处条保持静止尺寸。少条目时不再出现「整列一起变」的观感。（R1）
- [ ] AC3. 工作区轨可见时，消息滚动区左内边距为 48px；助手头像和正文不被 36px 轨挡住。少于 2 条提问或 docked 阅读器聊天时，左内边距仍为 12px，且没有轨。（R2）
- [ ] AC4. 既有跳转、底部跟随、当前项跟踪、会话/书籍预览不泄漏、docked 无目录 UI、中英可访问名称均保持。（R1）

## Out of Scope

- 阅读器 docked 聊天的任何对话目录。
- 复制 Paseo 的 918px 隐藏门槛、Appearance 开关、daemon prompt index。
- 改变 hover-intent 延迟、预览文案、跳转/stick-to-bottom 逻辑。
- 给 `ChatInput` 或标题栏加左 gutter。
- 把轨改成占位 flex 列或 ChatGPT 式整列标签。

## Technical notes

- 改 `src/components/chat/ChatOutlineRail.tsx` 的轨/slot class；测试补 slot 几何（`ChatOutlineRail.test.tsx`）。
- 改 `src/components/chat/ChatPanel.tsx` 滚动区 class：轨可见时 `py-3 pr-3 pl-12`，否则 `p-3`。`ChatPanel.test.tsx` 断言 workspace 有/无轨时的左内边距，docked 不变。
- Phase 3.3 更新 `.trellis/spec/frontend/component-guidelines.md`：删掉 “Do not steal layout width”，改为轨挂载时给消息列留 36px+12px 左缘；slot 写明 `basis-2 shrink` + 轨 `justify-center`。

## Key decisions

- 轨继续 overlay，用滚动区左 padding 让位，而不是独立列：保留 Paseo 的 10%–90% 垂直几何，输入框不跟着缩。
- 左内边距 48px = 36px 轨 + 12px 原 `p-3` 间隙。
- 邻近放大保留，靠改 slot 几何修复「全部在动」的观感，不改半径。
