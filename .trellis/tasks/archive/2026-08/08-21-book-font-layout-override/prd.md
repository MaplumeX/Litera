# Override book fonts and typography

## Goal

读者可以分别打开「覆盖字体」和「覆盖排版」，让自己的阅读设置压过 EPUB 自带样式；也可以只开一项，或都关着保留书籍原样。

## User Value

很多书内嵌 `@font-face` 和章节 CSS。用户改了字体或行距，正文仍显示书籍原样。两个独立开关让用户按需覆盖，不必一次改掉全部，也不必改设计排版完好的书。

## Background / Confirmed Facts

- 工作分支：`feat/book-font-and-layout-override-settings`。
- 阅读排版已有：字号、字体、行距、版心宽度、页边距、字间距、段距、首行缩进、对齐。书库改全局默认，阅读中改当前书，可「恢复默认」。主题只全局。
- 生效路径：`generateStylesCss` → `view.renderer.setStyles`。每次调用整份替换。
- 当前注入力度：`html, body` 上只有 `font-size` 带 `!important`；`p` 的段距和首行缩进带 `!important`。`font-family`、行距、字间距、对齐没有 `!important`，且只写在 `html, body`。书籍 CSS 写在 `p` / `span` / class / `@font-face` 上时，用户字体经常输。
- 全局默认在 `preferences.json`，单书覆盖在 `ReadingSettings`。两边 `deny_unknown_fields`。新键写出后，旧构建会把偏好文件当成损坏并重置主题 + 排版。
- 设置预览没有书籍 CSS，不能用来演示「覆盖是否压过出版社样式」。

## Key Decisions

- 两个独立开关：覆盖字体、覆盖排版。可只开一项。
- 覆盖字体：只压 `font-family`，并忽略书籍 `@font-face` 与元素级字体。字号不算进此开关。
- 覆盖排版：字号、行距、字间距、段距、首行缩进、对齐。
- 版心宽度、页边距始终生效，不进开关。
- 不覆盖书籍颜色、图片、标题装饰。
- 两个开关都默认关。未设置过的书保持今天的渲染。
- 作用域与现有排版相同：书库改全局默认，阅读中改当前书，每项可「恢复默认」。

## Requirements

### R1 开关

- R1.1 设置 → 排版里有两个独立开关：「覆盖字体」「覆盖排版」。
- R1.2 每个开关只有开 / 关。互不影响。
- R1.3 控件复用现有排版页的选项按钮（`SegmentedControl`），不新增开关组件。
- R1.4 文案走 i18n（zh-CN / en）。

### R2 覆盖字体（开）

- R2.1 用户选择的 `fontFamily` 压过书籍元素上的 `font-family` 和内嵌 `@font-face`。
- R2.2 标题也用用户字体；`code` / `pre` / `kbd` / `samp` 保持等宽，不被换成用户正文字体。
- R2.3 不改字号、行距、颜色、图片。

### R3 覆盖排版（开）

- R3.1 用户的字号、行距、字间距、段距、首行缩进、对齐压过书籍章节 CSS 里对应的规则。
- R3.2 不把标题的字号/字重/颜色压成与正文相同。
- R3.3 版心宽度、页边距保持今天的行为，不依赖此开关。

### R4 关闭时

- R4.1 两个开关都关时，阅读页渲染与今天一致：不加强、不削弱现有 `generateStylesCss`。
- R4.2 只开一项时，另一项仍按今天的力度注入。

### R5 作用域与持久化

- R5.1 书库设置改的是两个开关的全局默认。新开一本没有单书覆盖的书使用这些默认值。
- R5.2 阅读中改只写入当前书。该书「恢复默认」后该项回到全局默认。
- R5.3 缺省（从未写过）视为关。旧 `preferences.json` / `ReadingSettings` 没有这两个键时必须能读，且两个开关都是关。
- R5.4 不 bump `schemaVersion`。不把这两个键写进 `localStorage`。

### R6 预览与即时生效

- R6.1 阅读中切换开关后，当前打开的书立刻按新规则重注入 CSS，不必重开书。
- R6.2 设置预览继续只反映用户排版值，不模拟书籍 CSS 冲突。

## Acceptance Criteria

- [ ] 设置 → 排版可以看到「覆盖字体」「覆盖排版」两个开/关，互不影响。
- [ ] 默认（含旧偏好文件、旧书记录）两个开关都是关；关着的书看起来与本任务之前相同。
- [ ] 打开「覆盖字体」后，带内嵌字体或元素级 `font-family` 的书改用用户字体；`code`/`pre` 仍是等宽；字号和行距不因此改变。
- [ ] 打开「覆盖排版」后，书籍章节里的字号/行距/字间距/段距/缩进/对齐让位于用户设置；标题不因此变成正文字号。
- [ ] 版心宽度和页边距在开关开或关时都继续生效。
- [ ] 书库改开关 → 新开无覆盖的书跟随；阅读中改只影响当前书；「恢复默认」回到全局默认。
- [ ] 中英文标签齐全。
- [ ] `npm test`、`npm run build` 通过；相关 Rust 测试通过。

## Out of Scope

- 自定义字体文件上传、网页字体下载
- 覆盖应用外壳字体（外观页已有）
- 自定义主题色、亮度
- 固定版式 EPUB（foliate-fxl）
- 改现有滑条区间
- 一个总开关
- 覆盖书籍颜色、图片、标题装饰
- 默认打开覆盖
- 设置预览模拟出版社样式冲突
- 从阅读器里删除书籍 stylesheet / 改 foliate-js submodule

## Technical Notes

- 字段名：`overrideFont`、`overrideLayout`（camelCase）。单书用 `Option<bool>`：缺省 = 跟随全局；`false` 是显式关闭（全局开、这本书关）。
- 全局写 `preferences.json`，单书写 `ReadingSettings`。`serde(default)`，不 bump schema。新键一旦写出，旧构建的 `deny_unknown_fields` 会重置偏好文件；与既往排版字段同一发布约束。
- CSS 只通过加强 `generateStylesCss` 实现，不剥离书籍 stylesheet。
