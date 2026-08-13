# Optimize settings UI and add configurable items

## Goal

把设置从窄弹窗换成独立设置页，并补上阅读排版：行距、页边距/版心、正文对齐。书库改全局默认，阅读中改当前书，被覆盖的项可以恢复默认。

## Background

当前书库齿轮和阅读页 Aa 打开同一个 `SettingsDialog`（`sm:max-w-md`）。里面只有字号 S/M/L/XL、字体三档、主题三档，以及一个会再套一层的「打开 AI 配置」。字号/字体按书存在 `library.json` 的 `ReadingSettings`；主题存在 `preferences.json`。阅读 CSS 只注入 `font-family`、`font-size` 和主题色（`src/lib/reader-styles.ts`）。聊天齿轮单独打开 `AgentConfigDialog`，不能再打开一般设置（`08-13-split-settings-entry`）。

## Requirements

### R1 独立设置页

- 根视图增加 `settings`。书库齿轮和阅读页 Aa 进入该页，不再打开 `SettingsDialog`。
- 左侧分类：排版、外观、AI。右侧为对应表单。
- 从阅读页进入后再返回，回到同一本书的阅读页；不得走「返回书库」那条 `close_book` / 清空 `fileData` 路径。
- 从书库进入后再返回，回到书库。
- 设置页上看不到书页即时预览。

### R2 排版分类

- 字号 S/M/L/XL、字体 衬线/无衬线/等宽：行为与现在相同；没开书时禁用，文案「打开书籍后生效」。
- 新增行距：疏 / 中 / 密。
- 新增页边距：窄 / 中 / 宽（同时控制左右留白与版心宽度）。
- 新增对齐：左齐 / 两端。
- 从阅读页改行距/边距/对齐：写入该书覆盖。
- 从书库改这三项：写入全局默认。
- 该书某项已被覆盖时，该项旁显示「恢复默认」；点后清除该书该字段，回退到全局默认。
- 设置页需能看出当前是在改「这本书」还是「默认排版」（例如标题或说明）。

### R3 外观分类

- 主题 白天 / 夜间 / 护眼，仍只写全局偏好，书库和阅读进入时都能改。

### R4 AI 分类与聊天入口

- 设置页 AI 分类内嵌与 `AgentConfigDialog` 相同的表单，不再从设置页再开一层弹窗。
- 聊天面板齿轮和「打开设置」横幅仍只打开 `AgentConfigDialog`。
- 不给 `ChatPanel` 增加用于打开一般设置的回调。

### R5 生效与持久化

- 行距 / 页边距 / 对齐的生效值 = 该书覆盖 ?? 全局默认 ?? 内置默认。
- 字号/字体仍只按书；主题仍只全局。
- 回到阅读页（或下次打开该书）时，foliate 使用生效后的 CSS。
- 已有 `preferences.json`（只有 theme）不得被当成损坏文件整份重置，用户主题必须保留。

## Acceptance Criteria

- [ ] 书库齿轮进入独立设置页，左侧能切 排版 / 外观 / AI。
- [ ] 阅读页 Aa 进入同一设置页；返回后仍在该书阅读页，书未关闭。
- [ ] 书库里可改行距、页边距、对齐，新开一本没有覆盖的书使用这些默认值。
- [ ] 阅读中改这三项只影响当前书；「恢复默认」后该书回到全局默认。
- [ ] 字号/字体在书库设置页禁用；有书时仍按书保存。
- [ ] 主题在设置页外观分类可改，外壳与阅读区都跟随，重启后仍在。
- [ ] 设置页 AI 分类能完成与现弹窗相同的供应商 / Key / 模型配置，不再套第二层窗。
- [ ] 聊天齿轮只出现「LLM 设置」弹窗，不会跳到设置页。
- [ ] 已有只含 theme 的 `preferences.json` 升级后主题不被重置。
- [ ] `npm test` + `npm run build` 通过；相关 Rust 测试通过。

## Out of Scope

- 自定义字体上传、自定义主题编辑器。
- 书签、高亮、笔记、TTS。
- 把字号/字体改成全局默认 + 单书覆盖。
- 翻页手势、书库展示、快捷键。
- 显式「仅本书」开关，或默认/本书两套并列控件。
- 设置页上的书页即时预览。
- 改 LLM 保存 / 切换 / sidecar 协议。
- 继续把主设置做成弹窗。

## Technical Notes

- `ReadingSettings` 与 `PreferencesData` 均为 `deny_unknown_fields`。库文件用可选字段扩展、不 bump `library.json` schema。偏好文件保持 `schema_version = 1`，新字段必须能从旧文件默认出来；禁止「schema 不匹配就整文件写默认」。
- `update_reading_state` 整对象替换 `settings`，前端必须每次提交该书完整 settings 快照。「恢复默认」= 快照里去掉该键。
- `save_theme` 现在会重写整个 `preferences.json`，扩展后必须改成读-改-写。
- 入口约定见 `.trellis/spec/frontend/component-guidelines.md`「Settings entry ownership」；本任务会把一般设置的载体从 Dialog 换成 Page，聊天入口规则不变。
