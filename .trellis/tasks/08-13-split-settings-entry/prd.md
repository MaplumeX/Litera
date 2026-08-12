# Separate chat and library settings

## Goal

阅读页 AI 对话面板的设置入口只打开 LLM 配置；书库页的设置入口打开一般设置。一次点击不得同时弹出两个设置界面。

## Background

- 书库页齿轮打开 `SettingsDialog`（标题「设置」）：阅读偏好 + 「打开 AI 配置」。
- 阅读页顶栏 Aa 按钮也打开同一个 `SettingsDialog`，用于字号/字体/主题。本次不改这个入口。
- 阅读页 `ChatPanel` 齿轮（`aria-label="设置"`）本应只打开 `AgentConfigDialog`（标题「LLM 设置」）。
- 当前 `App.tsx:482` 把 `onOpenSettings={() => setSettingsOpen(true)}` 传给 `ChatPanel`。齿轮点击写成 `onOpenSettings?.() ?? setShowConfig(true)`（`ChatPanel.tsx:221`、`:235`）。`setSettingsOpen(true)` 返回 `undefined`，`??` 右侧也会执行，于是同时弹出「设置」和「LLM 设置」。

## Requirements

### R1 对话设置只开 LLM 配置

- 阅读页 AI 对话面板的齿轮按钮只打开 `AgentConfigDialog`。
- 未配置 LLM 时的「打开设置」按钮同样只打开 `AgentConfigDialog`。
- 不得再通过 `onOpenSettings` 去打开书库/阅读偏好用的 `SettingsDialog`。

### R2 书库设置保持一般设置

- 书库页齿轮继续打开 `SettingsDialog`（阅读偏好 + 从中进入 AI 配置）。
- 阅读页顶栏 Aa 按钮继续打开 `SettingsDialog`，不在本次改动范围内。

### R3 一次点击只开一个设置界面

- 点击对话齿轮时，页面上只能出现一个设置弹层：`AgentConfigDialog`。
- 点击书库齿轮时，只能出现 `SettingsDialog`。

## Acceptance Criteria

- [ ] 阅读页点击对话面板齿轮：只出现「LLM 设置」，没有「设置」叠在下面。
- [ ] 阅读页未配置 LLM 时点「打开设置」：只出现「LLM 设置」。
- [ ] 书库页点击齿轮：只出现「设置」，可读阅读偏好，并能从中打开 AI 配置。
- [ ] 阅读页顶栏 Aa 按钮行为不变，仍打开「设置」。
- [ ] `ChatPanel` 不再接收用于打开一般设置的 `onOpenSettings` 回调。
- [ ] `npm test` + `npm run build` 通过。

## Out of Scope

- 不改 `SettingsDialog` / `AgentConfigDialog` 内部表单与保存逻辑。
- 不改阅读页顶栏 Aa 按钮，也不改主题/字号/字体的数据模型。
- 不改 sidecar、后端、provider 协议。

## Technical Notes

- 最小改动：`App.tsx` 不再向 `ChatPanel` 传 `onOpenSettings`；删除 `ChatPanel` 的 `onOpenSettings` prop 及 `??` 回退。齿轮与「打开设置」一律 `setShowConfig(true)`。
- 不要用 `callback?.() ?? fallback()` 表达「有回调就只用回调」——void 函数返回 `undefined`，fallback 仍会执行。
