# Add i18n support

## Goal

用户可以把 Litera 的应用界面在简体中文和英语之间切换；未选过语言时跟随操作系统。

## Background

Litera 是 Tauri + React + Vite 桌面阅读器，没有 i18n 库。书库、阅读器、设置、聊天、导入/删除确认等界面文案几乎全部硬编码为中文；现有测试按这些中文字符串断言。

书籍正文来自 EPUB，不是应用 UI。`book-utils.ts` 已能从书名 language map 取值。Rust / sidecar 错误是英文，前端用 `invokeErrorMessage` 原样展示。`preferences.json` schema v1 只存主题和排版；`PreferencesDataRaw` 使用 `deny_unknown_fields`，往该文件加新字段会让旧版本把文件当成损坏并重置。

设置页已有「排版 / 外观 / AI」分区。前端 spec 规定没有全局状态库、也不用 React Context，状态走 `useState` + props。

## Requirements

- R1. 界面语言支持简体中文（`zh-CN`）和英语（`en`），用户可切换。
- R2. 翻译范围仅限 React 界面文案：书库、阅读器工具栏、设置、聊天、确认框、空状态、按钮、aria-label、前端自己拼的提示前缀（如「导入失败：」）。
- R3. 没有已保存的语言选择时，按操作系统语言决定：`zh*` → `zh-CN`，其余 → `en`。
- R4. 用户的语言选择跨重启保留。
- R5. 切换后界面立即更新，不需要重启应用。
- R6. 设置页「外观」提供语言切换。
- R7. 语言选项本身用该语言的自称（中文 / English），避免切到另一种语言后看不懂开关。

## Acceptance Criteria

- [ ] AC1. 设置 → 外观可以看到并选择「中文」和「English」。（R1, R6, R7）
- [ ] AC2. 选择后，当前已打开的书库 / 阅读器 / 设置 / 聊天等界面文案立即变成对应语言。（R1, R5）
- [ ] AC3. 重启应用后仍是上次选择的语言。（R4）
- [ ] AC4. 清除已保存语言后（或全新安装），系统语言为中文时界面为中文，否则为英文。（R3）
- [ ] AC5. 切换界面语言不改变 EPUB 正文、AI 回复内容，也不翻译 `invokeErrorMessage` 拿到的后端错误原文。（R2）
- [ ] AC6. 现有按中文文案断言的前端测试在默认测试环境下仍然通过；另有测试覆盖切到 `en` 后至少一处可见英文文案。（R1, R5）

## Out of Scope

- 翻译 EPUB 正文或 AI 回复内容。
- 翻译 Rust / sidecar 技术错误原文。
- 系统文件选择框、原生对话框。
- 从右到左（RTL）布局。
- 为每种语言做专门字体栈或排版规则。
- 繁体中文、日语或其他第三种界面语言。

## Key Decisions

- MVP 语言：简体中文 + English。
- 覆盖范围：只做 React 界面文案。
- 无已保存选择时跟随操作系统；`zh*` 归到简体中文。
- 用户选择需要持久化。

## Risks

- jsdom 默认 `navigator.language` 通常是 `en-US`。若测试不固定语言，现有中文断言会批量失败。
- 已有安装升级后，若本地还没有保存过语言，会按系统语言切换；英文系统上的现有用户会第一次看到英文界面。这是 R3 的直接结果。
