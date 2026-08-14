# Remove native window shell

## Goal

去掉 Litera 主窗口的系统标题栏。macOS 只保留左上角红绿灯；Windows / Linux 在现有顶栏右侧用应用自己画的按钮做最小化、最大化/还原、关闭。书库和阅读页都不另加一条标题栏。

## Background

Litera 是单窗口 Tauri v2 桌面应用。`src-tauri/tauri.conf.json` 的 `app.windows[0]` 只配置了 `title: "Litera"`、`800×600`、`visible: false`，没有关掉装饰，也没有 `titleBarStyle`。三个发布平台因此都带着操作系统标题栏。

前端没有窗口壳。书库 `LibraryView` 顶栏是 Litera 标题、搜索、导入、选择、设置。阅读页 `App.tsx` 顶栏是返回、书名、目录 / 书签 / 排版 / 聊天。设置、导入确认、Agent 配置都是应用内 Dialog。

关闭已接在系统关闭上：`App.tsx` 用 `getCurrentWindow().onCloseRequested` 先刷阅读进度，最多等 2 秒，再 `destroy()`。`src-tauri/capabilities/default.json` 目前只有 `core:default` 和 `core:window:allow-destroy`。窗口几何由 `tauri-plugin-window-state` 记 size / position / maximized，不进 `preferences.json`。

书库拖放 EPUB 走 `onDragDropEvent`，与窗口拖动是两套事件。当前分支是 `fix/remove-native-shell`。

跨平台成品应用（VS Code、Slack、Discord、Figma）按平台拆：macOS 用 Overlay 标题栏留红绿灯；Windows / Linux 关装饰、右侧自绘按钮。Tauri 入门的三端 `decorations: false` 会丢掉 Mac 窗口对齐和全屏能力，本任务不采用。

## Requirements

- R1. Windows / Linux 主窗口不显示系统标题栏和系统窗口按钮。macOS 不显示灰色标题条和窗口标题文字，但保留系统红绿灯。
- R2. 三端都能拖动窗口、最小化、最大化/还原、关闭。
- R3. 关闭（系统红绿灯、自定义关闭、Alt+F4 / Cmd+Q 等）都先刷阅读进度 / 偏好，再销毁窗口；超时与失败行为和现在一致。
- R4. 窗口大小、位置、最大化记忆继续有效，不写入 `preferences.json`。
- R5. 书库和阅读页现有工具栏功能保持可用，搜索、导入、选择、设置、返回、目录、书签、排版、聊天都不被窗口拖动抢走。
- R6. 窗口控件并进现有顶部工具栏。不另加一条标题栏。macOS 不画自定义窗口按钮；Windows / Linux 把最小化 / 最大化 / 关闭放在书库栏和阅读栏最右侧。
- R7. 顶栏标题文字和按钮之间的空白可拖窗口；搜索框和所有按钮不可拖。双击可拖空白处可最大化/还原。

## Acceptance Criteria

- [ ] AC1. Windows / Linux 启动后看不到系统标题栏；macOS 看不到灰色标题条，左上角仍是系统红绿灯（R1）。
- [ ] AC2. 三端都能拖动、最小化、最大化/还原、关闭（R2）。
- [ ] AC3. 用自定义关闭或系统关闭退出时，阅读进度按现有刷盘逻辑保存，不会因换成自定义按钮而丢失（R3）。
- [ ] AC4. 重启后窗口几何仍按现有 window-state 规则恢复；`preferences.json` 不被写入窗口字段（R4）。
- [ ] AC5. 书库搜索 / 导入 / 选择 / 设置，以及阅读页返回 / 目录 / 书签 / 排版 / 聊天，点击仍触发原功能，不会开始拖窗口（R5、R7）。
- [ ] AC6. 书库页和阅读页都没有第二条顶栏。macOS 顶栏右侧没有自定义窗口按钮；Windows / Linux 右侧有三个窗口按钮（R6）。
- [ ] AC7. 双击顶栏可拖空白处会最大化或还原（R7）。
- [ ] AC8. `npm test` 与 `npm run build` 通过。

## Out of Scope

- 不做多窗口、系统托盘、透明窗口、圆角阴影特效。
- 不改阅读进度、书库、sidecar、偏好 schema。
- 不恢复或记忆 fullscreen。
- 不做 Windows 11 Snap Layout 预览。
- 不自己画 macOS 红绿灯。

## Key Decisions

- 窗口控件并进现有顶部工具栏，不单独加标题栏。
- 按跨平台惯例拆：macOS Overlay + 系统红绿灯；Windows / Linux `decorations: false` + 顶栏右侧自定义按钮。
- 拖动只覆盖顶栏非交互空白；双击空白最大化/还原。
