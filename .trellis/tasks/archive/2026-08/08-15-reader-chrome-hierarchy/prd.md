# Tighten reader chrome hierarchy

## Goal

把阅读器外壳的层次收干净：chrome 退到后面，书页满幅顶到顶栏和进度条。不改阅读/Agent 信息架构，也不换视觉语言。

## User value

上一轮布局已经把顶栏分组和底栏进度摆对，但浅色下 `bg-muted/40` + `p-3` 几乎看不见，打开对话后又像两块同色白板夹着 12px 灰边。满幅之后书页就是窗口里的正文，分栏用一根竖线说清楚。

## Background

- `08-15-ui-refresh` 定了 Geist + 冷锌 token + 扁平层次。整窗是产品工具壳，书页字体/背景仍由用户阅读设置注入 iframe。
- `08-15-reader-layout-polish` 定了顶栏分组、书格底栏进度，以及「inset 或 1px 内描边」。实现只做了半透明 inset。本任务改成满幅，取代那个 inset。
- `08-13-reading-ui-layout` 否决了自动藏顶栏，目录/标注保持覆盖抽屉。
- 本任务是光学收口，不是新一轮换肤。

## Confirmed facts

- 阅读顶栏在 `src/App.tsx`：`titlebarClassName()` 给出 `h-12` + `border-b`；书名是 `text-lg font-semibold`（约 862 行）。分组已是 `[←][目录][标注] 书名 [Aa] | [模式][对话/书]`。
- 书格 `bg-muted/40`，内层 `absolute inset-0 p-3` 再套 `bg-background` 的 `ReaderView` 宿主（约 930–956 行）。浅色 token：`--background oklch(0.985)`，`--muted oklch(0.967)`，`/40` 后页边几乎看不见。
- `ReaderView` 根节点已是 `relative h-full w-full`（`src/components/ReaderView.tsx` 572 行）。翻页热区和选区相对 iframe，不依赖外框 padding。
- `ReaderProgressBar`（`src/components/ReaderProgressBar.tsx` 61 行）在书格底部、inset 外面，自带 `border-t`。
- 对话格是 `ChatPanel` 的 `bg-card`。浅色下 `--card` 等于 `--background`。docked 对话另有一条 `border-b` 标题栏（`src/components/chat/ChatPanel.tsx` 320 行）。分栏没有竖线。阅读模式对话在右，Agent 模式书在右；现有 resize handle 始终画在右栏左缘。
- 目录/标注抽屉标题是 `border-b px-4 py-3`（`TocSidebar.tsx` 55 行，`AnnotationsSidebar.tsx` 33 行）。
- 书库顶栏标题同样是 `text-lg font-semibold`（`LibraryView.tsx` 189 行）。
- 不改 `src/foliate-js`，不把 Geist 写进 `generateStylesCss`，不往 `preferences.json` 加字段。

## Decisions

- **D1** 不重做视觉语言：字体、色板、圆角、图标库保持现状。
- **D2** 不改信息架构：顶栏按钮分组、底栏进度交互、覆盖抽屉、阅读/Agent 双格、默认收起对话，全部保持。
- **D3** 同一条缝只表达一次：要么用线，要么用表面色差，不要两个都上。
- **D4** 顶栏布局不动。只降书名视觉重量。书库标题一并降，避免两个顶栏字号分家。
- **D5** 书页满幅：去掉 muted gutter 和 `p-3` inset。书页顶到顶栏和进度条。打开对话时用一根竖线分栏，不做「纸」式井和内描边。

## Requirements

### R1 书名降重

- 阅读顶栏书名从 `text-lg font-semibold` 改为 `text-sm font-medium`。
- 书库顶栏 `Litera` 用同一档字号/字重。
- 拖拽热区、截断、`h-12`、macOS inset、窗口按钮不变。

### R2 书页满幅

- 去掉书格 `bg-muted/40` 和 `p-3` 包装。`ReaderView` 直接铺满书格里进度条以上的区域。
- 进度条仍在书格底部，用自己的 `border-t` 作为与书页的唯一分隔。不要书页底再空一截 gutter。
- 打开对话后，右栏左缘有一根 `border` 竖线。阅读模式画在对话格，Agent 模式画在书格。侧栏收起时不画。
- 不改翻页热区、选区工具条、高亮坐标语义。用户阅读字体/主题继续只作用在书页上。

### R3 去掉重复的缝

- 顶栏 `border-b` 保留。
- docked 对话去掉标题栏 `border-b`，避免和窗口顶栏叠出两条横线。会话/设置入口仍在。Agent workspace 标题栏保留 `border-b`。
- 目录/标注抽屉标题压到和顶栏同一 denseness（约 `h-12` + `px-3`），仍是覆盖抽屉。
- Aa 与模式之间的竖线保留。

### R4 既有行为

- 阅读/Agent 双格、默认阅读模式、对话默认收起、开合只记进程、不 remount `ReaderView` / `ChatPanel`。
- 点页、方向键、滚轮翻页不变。
- 选区高亮 / 问 agent、书签、位置恢复、设置对话框、i18n、窗口控件不变。
- 不往 `preferences.json` 加字段。不新增可见文案也可以；若改 aria，zh-CN / en 必须成对。

## Acceptance Criteria

- [ ] AC1. 阅读顶栏书名和书库顶栏 `Litera` 都是 `text-sm font-medium`，不再是 `text-lg font-semibold`。（R1）
- [ ] AC2. 书格没有 `bg-muted/40` 和 `p-3` inset。`reader-view` 铺满进度条以上的书格。（R2）
- [ ] AC3. 进度条仍是 `reader-book-cell` 的最后一个子节点，带 `border-t`，上方不再有 gutter。（R2）
- [ ] AC4. 侧栏打开时右栏有竖向 `border`；侧栏收起时没有。阅读模式竖线在对话格，Agent 模式在书格。（R2）
- [ ] AC5. docked `ChatPanel` 标题栏没有 `border-b`；workspace 变体仍有。会话和设置按钮仍可点。（R3）
- [ ] AC6. 目录/标注仍是覆盖抽屉；抽屉标题行高度与窗口顶栏同级，不再是 `py-3`。（R3, R4）
- [ ] AC7. 顶栏按钮分组、拖拽热区、翻页/选区/高亮/模式切换语义与现有测试一致；`npm test` 与 `npm run build` 通过。（R1, R4）

## Out of scope

- 自动隐藏顶栏或进度条
- 目录钉成固定第三列
- 换字体、色板、圆角、图标库、UI 框架
- 暖纸色铺满应用壳，或把 Geist 写进书页 CSS
- 书库网格、对话气泡、设置对话框再设计
- 页码、剩余时间、书内搜索、上一页/下一页按钮
- Agent 协议、sidecar、持久化 schema
