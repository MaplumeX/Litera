# Agent chat LaTeX math rendering

## Goal

Agent 聊天界面的助手消息当前以 `react-markdown` + `remark-gfm` 渲染 Markdown，但没有任何数学插件，`$...$` / `$$...$$` / `\[...\]` 形式的 LaTeX 公式会以原始文本原样显示。本任务为助手消息渲染管线加上数学支持，使行内与块级公式正确排版。

## Background（已确认事实）

- 助手消息渲染入口：`src/components/chat/AssistantMessage.tsx` 的 `TextBlock`（`<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>`，约 line 71-74）。思考块（`ThinkingBlock`）是纯文本 `whitespace-pre-wrap`，不走 Markdown。
- 用户消息（`MessageBubble.tsx`）与工具调用卡片不做 Markdown 渲染。
- 依赖中无 `remark-math` / `rehype-katex` / `katex` / MathJax（全仓库 grep 无命中）。
- Tauri CSP（`src-tauri/tauri.conf.json` line 22-23）：`style-src 'self' 'unsafe-inline'`、`font-src 'self' blob: data:`。KaTeX CSS 与其字体经 Vite 打包为 `'self'` 本地资源，满足现有 CSP，无需放宽。
- `.trellis/spec/frontend/component-guidelines.md` line 23 已把 `react-markdown` + `remark-gfm` 登记为 agent 回答渲染方案。
- 现有测试：`src/components/chat/AssistantMessage.test.tsx`（jsdom + @testing-library，已有 "renders common markdown as structured HTML" 用例可扩展）。

## Requirements

- R1: 助手文本块支持行内公式（`$...$`）与块级公式（`$$...$$`）渲染，输出为排版后的 KaTeX HTML，而非原始 LaTeX 文本。
- R2: 无效/未知 LaTeX 语法不抛错、不中断整条消息渲染，降级为可见的错误占位（rehype-katex 默认 `errorColor` 行为可接受）。
- R3: 流式渲染（streaming）期间部分公式（尚未闭合的 `$`）不得导致整条消息渲染崩溃；闭合前的残缺片段按普通文本显示即可。
- R4: KaTeX 样式与字体在 Tauri 生产构建下正常加载（遵守现有 CSP，不放宽）。
- R5: 公式容器支持横向滚动（长公式不撑破气泡布局，与现有 `overflow-x-auto` 处理一致）。
- R6: 用户消息与思考块维持现状（不加数学渲染）——agent 回复才是公式的来源。

## Acceptance Criteria

- [ ] AC1: 助手消息含 `$E=mc^2$` 时渲染出 KaTeX 排版节点（如 `.katex` 类存在），且不出现原始 `$E=mc^2$` 文本。
- [ ] AC2: 助手消息含 `$$\int_0^1 x\,dx$$` 时渲染块级公式（`.katex-display`），容器可横向滚动。
- [ ] AC3: 含 `\frac{` 之类残缺公式的流式片段渲染不崩溃、不抛异常。
- [ ] AC4: 含非法 LaTeX 的消息渲染出错误占位而非整条消息空白。
- [ ] AC5: `npm run build`（tsc + vite build）通过；KaTeX CSS 被打包进产物，字体引用为本地资源。
- [ ] AC6: 现有测试全部通过，并为 AC1-AC4 增加对应测试用例。

## Out of Scope

- 用户输入消息的公式渲染
- 思考块（thinking）内的公式渲染
- 公式点击放大 / 复制 LaTeX 等交互
- MathJax 方案（选定 KaTeX：体积小、无网络依赖、渲染快）
- 阅读器（EPUB 阅读区）内的数学内容渲染

## Open Questions

（无——技术选型与范围已由仓库证据 + 上轮讨论确定：KaTeX + remark-math + rehype-katex。）
