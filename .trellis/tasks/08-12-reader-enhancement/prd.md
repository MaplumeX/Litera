# Reader Enhancement

## Parent

`08-12-library-reader-ux` — Library & Reader UX Overhaul

## Goal

为 Litera 阅读界面补齐主流阅读器能力：目录侧边栏（章节跳转）、字体大小/字体族调节、主题切换（白天/夜间/护眼）、阅读位置自动恢复、"返回书库"入口，同时保留现有 AI 对话面板与翻页功能。

## User Value

用户在阅读时获得与主流阅读软件一致的导航与个性化体验：快速跳转章节、调节舒适的字体与主题、重开书自动回到上次位置，降低"这不像个阅读器"的违和感。

## Background / Confirmed Facts

### 现有代码状态（已勘察）

- **App.tsx**：顶部 header（标题 + "打开文件" + "显示/隐藏对话"）→ 阅读区/聊天区分栏 → 底部翻页栏（上一页/下一页 + 章节标签 + 进度百分比）。无目录侧边栏、无字体/主题控制、无"返回书库"。
- **ReaderView.tsx**：封装 `<foliate-view>`，暴露 `prev/next`。监听 `relocate` 事件回调 `onRelocate(index, fraction, label)`。选段捕获浮出"问 agent"按钮。
- **foliate.js View API**（`src/foliate-js/view.js`）：
  - `view.book.toc` — 目录树（`[{ label, href, subitems? }]`）
  - `view.goTo(target)` / `view.goToFraction(frac)` — 导航跳转
  - `view.getSectionFractions()` — 各章节起始 fraction
  - `view.getProgressOf(index, range)` — 当前位置进度
  - `view.init({ lastLocation, showTextStart })` — 初始化时恢复位置
  - `view.renderer.getContents()` → `[{ doc, index }]` — 可访问 iframe document 注入 CSS
- **foliate.js 无内置 setAppearance API**：字体/主题需通过向 iframe 内容（`renderer.getContents()[*].doc`）注入 CSS 实现。需在每次 section 加载（`load` 事件）后重新注入。
- **ChatPanel.tsx**：选段问答 + 多会话 + 流式输出，功能完整，不改动。
- **Tauri app data 目录**：`app.path().app_data_dir()` 可用于持久化阅读设置。
- **CSP**：`style-src 'self' 'unsafe-inline'` — 允许注入 inline style 到 iframe。

### 技术约束

- 字体/主题注入：监听 foliate-view 的 `load` 事件（每次 section 加载触发），向 `doc.documentElement` 注入 CSS（字体族、字体大小、颜色/背景）。需覆盖所有已加载的 iframe document。
- 位置恢复：用 `view.init({ lastLocation })` 或 `goToFraction(frac)` 在打开后跳转。
- 阅读设置持久化存储由 `08-12-library-management` 任务的存储基础设施提供（每本书的 settings）。

## Key Decisions

- **字体调节 = 注入 CSS 到 iframe document**：监听 `load` 事件向 `doc.documentElement.style` 设置 `font-family` / `font-size`，每次 section 加载后重新注入。
- **主题切换 = CSS 变量/颜色注入**：白天/夜间/护眼三套颜色方案，注入到 iframe document 的 root 元素。
- **位置恢复 = fraction 持久化 + goToFraction**：relocate 时记录 fraction 到书库元数据，重开书时用 `goToFraction` 跳转。
- **目录侧边栏 = 独立可折叠面板**：从 `book.toc` 渲染章节树，点击调 `view.goTo(href)`。

## Requirements

### 返回书库
- 阅读界面有"返回书库"入口（header 按钮），点击后回到书库视图。
- 返回书库时保留当前阅读位置（已通过 relocate 持久化）。

### 目录侧边栏
- 阅读界面有可折叠的目录侧边栏。
- 目录从 `book.toc` 渲染为章节列表（支持嵌套层级缩进）。
- 点击章节 → 调 `view.goTo(href)` 跳转到对应位置。
- 跳转后侧边栏可保持打开或自动收起（MVP 保持打开）。

### 字体调节
- 字体大小可调（如 12px–24px 范围，步进 1px 或预设档位）。
- 字体族可选（至少衬线/无衬线两种，如 serif / sans-serif；可选更多预设）。
- 调整即时生效于阅读内容（无需重开书）。

### 主题切换
- 至少三种主题：白天（白底黑字）、夜间（黑底白字）、护眼（米黄底深棕字）。
- 切换即时生效于阅读内容。

### 位置恢复
- 重开同一本书时自动跳转到上次阅读到的位置（fraction）。
- relocate 事件触发时持久化当前位置（写入书库元数据）。

### 阅读设置持久化
- 字体大小、字体族、主题选择持久化到每本书。
- 重开同一本书后恢复上次的字体与主题设置。

### 保留现有功能
- 保留 AI 对话面板（选段问答、多会话、流式输出）功能不变。
- 保留翻页（上一页/下一页）与进度显示。

## Acceptance Criteria

- [ ] 阅读界面有"返回书库"入口，点击后回到书库视图。
- [ ] 目录侧边栏显示章节列表（含嵌套层级），点击章节能跳转到对应位置。
- [ ] 字体大小可调，调整即时生效于阅读内容。
- [ ] 字体族可切换，切换即时生效于阅读内容。
- [ ] 能在白天/夜间/护眼主题间切换，切换即时生效。
- [ ] 字体与主题设置持久化：重开同一本书后恢复上次的设置。
- [ ] 重开同一本书时自动恢复到上次阅读到的位置。
- [ ] 现有 AI 对话面板功能（选段问答、多会话、流式输出）不受影响。
- [ ] 现有翻页（上一页/下一页）与进度显示不受影响。

## Dependencies

- **依赖 `08-12-library-management`**：书库视图与书库元数据存储基础设施需先就绪，"返回书库"才能回到书库视图，阅读设置/位置才能持久化。此任务的实现可先在现有 App.tsx 上开发，但"返回书库"接线需在书库视图存在后完成。
- 阅读位置持久化写入需调用 library-management 提供的 Rust 命令（更新 book record 的 `lastFraction`）。

## Out of Scope

- 书签、高亮、笔记（v2 候选）
- TTS、翻译、词汇解释（v2 候选）
- 阅读进度条拖拽跳转（v2 候选，MVP 仅保留翻页 + 百分比显示）
- 自定义主题/自定义字体上传（v2 候选）
- 书库视图本身 ——由 `08-12-library-management` 负责

## Open Questions

（无——所有产品决策已解决，技术未知项在 design.md 中研究解决）