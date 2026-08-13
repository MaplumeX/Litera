# Settings as dialog instead of page

## Goal

设置不再作为独立全屏页替换书库/阅读，而是覆盖在当前页上的居中模态框。关掉后仍停在原来的书库或阅读页。

## Background

`App` 把 `settings` 做成第三种根视图。书库齿轮和阅读页 Aa 走 `openSettings` → `setView("settings")`，整页换成 `SettingsPage`，书库/阅读被卸载。从阅读页进入前会把 `lastFraction` 写入 `currentBook`，返回靠 `settingsReturnTo`，且不得走 `close_book`。

`SettingsPage` 左侧分类：排版、外观、AI。排版是连续滑条加字体/对齐；外观是主题和语言；AI 内嵌 `AgentConfigForm`。阅读中改该书覆盖，书库改全局默认；主题和语言始终全局。聊天齿轮 /「打开设置」只开 `AgentConfigDialog`。

## Requirements

### R1 一般设置是居中模态框

- 书库齿轮和阅读页 Aa 打开居中模态框（现有 shadcn `Dialog`），不再把 `view` 切到 `settings`。
- 打开时当前书库或阅读页保持挂载。
- 点遮罩、Esc 或关闭按钮关掉后，仍停在打开前的那一页；阅读中不得 `close_book`，进度不得丢。
- 应用里不再出现独立的全屏设置页。

### R2 内容与作用域不变

- 弹窗内仍是排版 / 外观 / AI 三类，控件与现设置页相同。
- 阅读中打开：排版改该书覆盖；书库打开：排版改全局默认。主题、语言仍只写全局。
- 「恢复默认」行为不变。
- 不改持久化协议、schema、sidecar。

### R3 聊天入口不变

- 聊天齿轮和未配置横幅「打开设置」仍只打开 `AgentConfigDialog`。
- 不给 `ChatPanel` 增加打开一般设置的回调。

## Acceptance Criteria

- [ ] 书库点齿轮：当前书库仍在，上面弹出居中设置框；关掉后仍是书库。
- [ ] 阅读中点 Aa：书仍开着，上面弹出居中设置框；关掉后仍在同一本书同一阅读页。
- [ ] 应用里不再出现独立的全屏设置页（没有 `view === "settings"`）。
- [ ] 弹窗内仍可改排版 / 外观 / AI，作用域与现在一致。
- [ ] 聊天齿轮只出现「LLM 设置」，不打开一般设置弹窗。
- [ ] `npm test` + `npm run build` 通过。

## Out of Scope

- 不改排版项、精调范围、持久化字段。
- 不改 LLM 保存 / 切换 / sidecar 协议。
- 不把聊天齿轮改成打开一般设置。
- 不新做设置页正文预览区。
- 不做锚在按钮旁的浮层或侧栏。

## Technical Notes

- 阅读页保持挂载时，已有的 `styleState` → `setStyles` 效果会让排版改动立刻作用到书上；这是不卸载阅读页的自然结果，不是另做预览区。
- 关闭时仍应 flush 已调度的偏好/排版写入，避免刚拖完滑条就退出进程时丢失。
