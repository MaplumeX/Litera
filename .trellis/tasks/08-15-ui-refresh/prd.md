# Beautify desktop reader UI

## Goal

让 Litera 的桌面壳摆脱默认 shadcn 脚手架感，变成一套冷静、精确的产品工具外观。功能、信息架构和阅读/Agent 布局保持不变。

## Background

Litera 是带阅读助手的跨平台 EPUB 阅读器（Tauri + React 19 + Tailwind v4 + shadcn/ui）。用户主要待在书库、阅读器（含 Agent 模式）、对话和设置。

当前视觉几乎是 shadcn 默认 zinc：`src/index.css` 用纯白 / 近黑中性 token，应用壳没有自托管字体，书库是 `border + shadow-sm` 封面网格，删除按钮是 emoji `✕`，阅读器壳和对话气泡是默认组件皮。图标库已锁定为 `lucide-react`。

这次是现有产品 UI 的视觉升级，不是落地页，也不是重做交互。

## Confirmed facts

- 技术栈不换：React + Tailwind v4 + 现有 shadcn 组件
- 窗口标题栏、阅读/Agent 双模式、TOC/标注 overlay、进度条、对话面板宽度规则都已有约定，默认不动
- 正文排版由设置控制并注入 foliate iframe；应用壳字体和正文设置是两套
- 主题已有 `light` / `dark` / `system`（`resolveTheme` + `.dark`）
- 文案走 `useT()`，zh-CN / en 都要跟上
- 不往 `preferences.json` 塞新字段（`deny_unknown_fields`）
- CSP `font-src` 只有 `'self' blob: data:`，字体必须自托管，不能走 Google Fonts CDN

## Decisions

- D1. 视觉方向：产品工具气质。冷、精确、扁平，接近 Linear，而不是暖纸阅读器，也不是只打磨默认 shadcn。
- D2. 覆盖面：这一次同时改书库、阅读器壳、对话和设置。先换 token / 字体 / 通用组件，再扫各面，按整窗一套语言验收。
- D3. 应用壳字体换自托管 Geist。只作用于工具栏、书库、对话、设置；不影响用户给书页选的正文字体。

## Requirements

- R1. 建立一套统一的应用壳视觉语言（颜色、圆角、间距、字重），light / dark 都成立。中性色走冷灰（zinc / slate 一族），不要纯白纯黑，不要暖纸/骨色，也不要紫蓝 AI 渐变。强调色最多一个，饱和度克制；默认用近黑 / 近白做主色，不加第二品牌色。
- R2. 书库、阅读器壳、对话、设置对话框必须在本次全部落到同一套语言，不能一块新一块旧，也不能先只交书库。
- R3. 不改变阅读/Agent 布局、路由、窗口控件、选书/导入/删除行为。
- R4. 不改变 EPUB 正文排版设置的语义；用户选的字体、字号、主题继续作用在书页上。应用主题仍是 `light` / `dark` / `system`。书页背景跟用户已有阅读主题。
- R5. 空状态、hover / active / focus、加载中这些交互状态要完整，不能只画成功态。
- R6. 继续用现有 shadcn 组件和 lucide 图标，不为更好看换图标库或重写组件体系。书库删除按钮从 emoji `✕` 换成 lucide `X`。
- R7. 阴影几乎不用；层次靠 1px 边框、细分割线和背景阶，而不是卡片浮起。
- R8. 应用壳使用自托管 Geist 可变字体，并带 CJK 系统回退（Geist 不含中日韩字形）。不要把 Geist 写进 foliate 书页 CSS，也不要把它加进阅读正文字体列表。

## Acceptance Criteria

- [ ] AC1. 打开书库、阅读器壳、对话和设置，四处都是同一套冷静、精确的产品工具外观，而不是默认 shadcn 模板，也不是暖纸阅读器。（R1, R2, R7）
- [ ] AC2. 应用壳是 Geist；中文界面回退到系统黑体，不出现空白方框。书页字体仍只跟设置里的正文选择。（R8, R4）
- [ ] AC3. light / dark 两套都可用，正文和控件对比度达到 WCAG AA。（R1）
- [ ] AC4. 导入、打开、选择、删除、翻页、对话、设置这些现有流程行为不变。（R3, R4）
- [ ] AC5. 新增或改动的可见文案走 `useT()`，zh-CN / en 都在。（R5）
- [ ] AC6. 现有前端测试仍然通过。（R3, R6）

## Out of scope

- 重做阅读/Agent 信息架构或面板布局
- 换图标库、换 UI 框架、换状态管理
- 改 EPUB 渲染引擎或 foliate.js
- 给阅读正文加 Geist，或做自定义主题编辑器
- 新功能（封面整理、书架分类等）
- 营销页 / 落地页
