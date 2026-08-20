# Settings dialog typography preview

## Goal

在设置对话框的「排版」(typography)区域内增加一个实时预览区,显示一段示例文本,让用户在调整阅读器字体/排版设置(字体族、字号、行高、字间距、段距、首行缩进、版心宽度、对齐)时立刻看到效果,而无需关闭对话框到阅读区确认。

## Background

当前 `SettingsDialog` 的 typography 区域提供阅读器排版控件(`SliderRow` / `FontFamilyPicker` / `SegmentedControl`),改动通过 `onTypographyChange` 回调到 `App` 更新 `styleState` 并最终 `generateStylesCss` 注入 foliate iframe。设置对话框本身没有预览,用户必须关闭对话框才能看到阅读区的变化,调字体需要反复打开/关闭,体验不佳。

`SettingsDialog` 已接收 `styleState: ReaderStyleState`(当前正在编辑的完整排版状态,包含书籍覆盖或全局默认),它就是预览应反映的数据源。

外观(appearance)区域的界面字体设置已通过 `applyUiChrome` 实时生效,不在本次预览范围内。

## Requirements

### R1 预览区位置与可见性

- R1.1 预览区位于「排版」区域内,在排版控件上方,作为用户进入排版区域时首先看到的内容。
- R1.2 预览区仅在 `section === "typography"` 时渲染;外观 / AI / 关于 区域不显示预览。
- R1.3 预览区不取代现有排版控件,控件保持原样位于预览区下方。

### R2 预览内容

- R2.1 预览区显示一段固定的示例文本,随界面语言切换(zh-CN 显示中文示例,en 显示英文示例),含段落结构,足以体现字体族、字号、行高、字间距、段距、首行缩进、对齐的差异。
- R2.2 示例文本至少包含两段,以体现段距与首行缩进效果。
- R2.3 示例文本固定(不随书籍内容变化),确保用户对比的是设置差异而非文本差异。

### R3 预览样式实时反映当前排版状态

- R3.1 预览文本的样式由当前 `styleState` 派生,复用 `generateStylesCss`(或其等价逻辑)生成 CSS,确保预览与真实阅读区渲染一致。
- R3.2 用户拖动滑块 / 切换字体 / 切换对齐时,预览立即更新(无需等待外部状态回写)。
- R3.3 预览不受 `theme` 影响(预览区始终使用适合对话框内深/浅色的中性背景,不模拟夜间主题),因为 `generateStylesCss` 的主题分支会向 `html, body` 注入全局背景色,在对话框内不适用。预览只反映排版(字体族、字号、行高、字间距、段距、首行缩进、版心宽度、对齐)。
- R3.4 预览区有明确的视觉边界(如圆角边框 / 背景区分),与下方控件区分开。

### R4 i18n

- R4.1 示例文本随界面语言切换,通过 `useT()` 使用 `MessageKey` 引用(zh-CN / en 各一段本地化示例)。
- R4.2 预览区有「预览」标签,需 i18n。

### R5 不破坏现有行为

- R5.1 不改变 `SettingsDialog` 的 props 接口(`styleState` 等不变)。
- R5.2 不改变 `generateStylesCss` 的签名或其对 foliate iframe 的输出行为(预览可复用其排版部分,但不得引入夜间主题全局背景到对话框内)。
- R5.3 现有测试除因新增预览区产生的必要调整外,行为保持一致。
- R5.4 对话框固定尺寸(`w-[768px] h-[40rem]`)保持不变;预览区在右侧可滚动区域内,不撑破布局。

## Acceptance Criteria

- [ ] AC1 打开设置对话框默认进入「排版」区域,可见示例文本预览区位于控件上方。
- [ ] AC2 拖动「字体大小」滑块,预览文本字号实时变化(可在预览 DOM 上读到对应 `font-size`)。
- [ ] AC3 切换「字体」(衬线 / 无衬线 / 等宽 / 系统字体),预览文本 `font-family` 实时变化。
- [ ] AC4 调整「行距」「字间距」「段距」「首行缩进」「版心宽度」「左右内边距」,预览对应样式属性实时变化。
- [ ] AC5 切换「对齐」(左齐 / 两端),预览 `text-align` 实时变化。
- [ ] AC6 切换到「外观」「AI」「关于」区域,预览区不渲染。
- [ ] AC7 预览区不注入夜间主题全局背景色(在浅色对话框背景下保持可读)。
- [ ] AC8 预览文本在 zh-CN 与 en 下分别显示对应语言的本地化示例内容。
- [ ] AC9 现有 `SettingsDialog.test.tsx` 测试通过(必要时因新增预览区调整查询,但不改变被测行为语义)。
- [ ] AC10 新增测试覆盖预览区渲染、实时样式更新、跨区域隐藏。
- [ ] AC11 对话框固定尺寸不因预览区改变。

## Out of Scope

- 外观区域的界面字体/字号预览(已实时生效)。
- 预览区模拟真实 foliate iframe 的分页/翻页行为。
- 预览区跟随主题(夜间/白天)变化背景。
- 预览区使用真实书籍内容。
- 调整 `SettingsDialog` props 接口。

## Technical Notes

- 预览样式派生:复用 `generateStylesCss` 的排版 CSS 部分(`html, body { font-family; font-size; line-height; letter-spacing; max-width; margin-inline; padding-inline; text-align; } p { margin-block-end; text-indent; }`),但剥离 `THEME_CSS` 分支。可在 `reader-styles.ts` 增加一个 `generatePreviewCss(state)` 或拆分现有函数,避免在对话框内注入 `html, body { background; color }`。
- 预览组件可放在 `src/components/settings/` 内,复用 `styleState` prop。
- 示例文本随界面语言切换,固定字符串经 i18n(zh-CN / en 各一段本地化示例)。
- 预览容器通过 `dangerouslySetInnerHTML` + `<style>` 注入或直接 inline style;考虑到 `generateStylesCss` 已是 CSS 字符串,用 `<style>` + 容器 className 更贴合现有模式。