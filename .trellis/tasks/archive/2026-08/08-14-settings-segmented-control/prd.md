# Settings exclusive choices use segmented control

## Goal

设置里 2–4 项互斥选项改成常见应用的分段控件：标签仍在上、控件铺满一行；一个浅底槽、选项无缝相连、选中块在内部标出。不再用一排各自描边、各自圆角的独立小按钮。

## Background

`SettingsDialog` 的离散互斥项走本地 `ChoiceButton`（`src/components/settings/SettingsDialog.tsx`：`flex-1 rounded border`，选中 `bg-primary`，行内 `gap-1`）。当前三处：

- 排版：对齐（起始 / 两端对齐）
- 外观：主题（白天 / 夜间 / 护眼）
- 外观：语言（中文 / English）

字体已改为可搜索 combobox。左侧分类是导航列表，不是互斥切换。点击即生效的行为已经正确；本任务只改控件外观、互斥语义和对应测试。

## Requirements

### R1 分段控件 + 行布局 A

- 主题、语言、对齐换成同一套分段控件。
- 行布局保持 A：上标签、下控件铺满一行。`PresetRow` 的标签 / 「恢复默认」位置不变。
- 视觉：单一浅底容器；选项无缝相连；选中项是内部浅色高亮块，不是整颗实心主色按钮。未选项没有独立描边。

### R2 行为不变

- 点击某段即选中并走现有回调：`onThemeChange` / `setLocale` / `onTypographyChange("textAlign", …)`。
- 同一组同时只有一段选中。
- 不改选项集合、标签文案、持久化、作用域（主题全局、语言 `localStorage`、对齐走现有排版覆盖）。

### R3 无障碍与测试

- 每组是互斥选择，不是三个无关按钮。键盘可在组内移动并选中。
- 现有按可见标签点击的路径仍成立；角色若从 `button` 改为 `radio`，同步改 `SettingsDialog.test.tsx`。

## Acceptance Criteria

- [ ] 外观页主题、语言，以及排版页对齐，都是分段控件，不是一排独立描边按钮。
- [ ] 这三行仍是上标签、下铺满一行；不改成左标签右控件。
- [ ] 点主题 / 语言 / 对齐仍分别调用现有 `onThemeChange` / `setLocale` / `onTypographyChange`，选项集合不变。
- [ ] 分类导航、滑块、字体 combobox、AI 表单外观与行为不变。
- [ ] `SettingsDialog.test.tsx` 覆盖的点击与文案切换仍通过；补一条三组互斥语义断言。
- [ ] `npm test` 通过。

## Out of Scope

- 左侧分类导航改成分段控件。
- 字体 combobox、滑块、AI 供应商/模型选择。
- 新增设置项、改默认值或持久化。
- 整页改成「左标签、右控件」设置列表。
- 自定义主题、更多语言、更多对齐方式。
- 把 `locale` 写入 `preferences.json`。

## Technical Notes

- 语言仍走 `useT().setLocale`，不要写 `preferences.json`（见 `.trellis/spec/frontend/i18n.md`）。
- 设置弹窗壳尺寸与入口约定见 `.trellis/spec/frontend/component-guidelines.md`。
- 实现边界见同目录 `design.md`。
