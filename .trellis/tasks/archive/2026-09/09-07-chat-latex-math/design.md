# Design — Agent chat LaTeX math rendering

## 技术选型

`remark-math` + `rehype-katex` + `katex`（与现有 react-markdown v10 / unified 11 管线同生态，版本兼容）：

- `remark-math@6`：把 `$...$` 解析为 `inlineMath`、`$$...$$` 为 `math` 节点（mdast）。
- `rehype-katex@7`：把 math 节点渲染为 KaTeX HTML（`katex@0.16.x` runtime）。
- `katex/dist/katex.min.css`：一次全局导入（`AssistantMessage.tsx` 或全局样式入口），Vite 会把其引用的 woff2/woff/ttf 字体作为 hashed 本地 asset 打包，满足 Tauri CSP `font-src 'self'`，无需改 `tauri.conf.json`。

被否方案：MathJax（体积大、异步加载复杂）；手写解析（无意义重复造轮子）。

## 改动边界

只动一个渲染入口：

1. `src/components/chat/AssistantMessage.tsx` — `TextBlock` 的 `ReactMarkdown`：
   - `remarkPlugins={[remarkGfm, remarkMath]}`
   - `rehypePlugins={[rehypeKatex]}`
   - 导入 `katex/dist/katex.min.css`
   - `markdownComponents` 增加针对 rehype-katex 输出的可选样式钩子不需要（KaTeX 自带 class；横向滚动通过现有外层 `overflow-x-auto` + 一条 `.katex-display { overflow-x: auto }` 全局 CSS 兜底实现）。
2. 全局样式入口追加 KaTeX 溢出兜底（若 `src/index.css` / tailwind 入口存在，则加在 prose 附近；具体文件由实现时确认，保持最小改动）。

不改：`MessageBubble`、`ThinkingBlock`、`ToolCallCard`、Tauri 配置、后端。

## 数据流与契约

```
agent 文本块 → ReactMarkdown
  → remark: remarkGfm + remarkMath（$/$$ 语法 → math 节点）
  → rehype: rehypeKatex（math 节点 → katex-rendered HTML）
  → DOM（.katex / .katex-display）
```

无持久化数据变化；纯展示层。历史会话重新打开时同样受益（渲染在展示时发生）。

## 兼容与风险

- **流式残缺片段**：`$` 未闭合时 remark-math 视为普通文本，无风险；闭合但内容残缺（如 `\frac{`）时 rehype-katex 抛 ParseError——rehype-katex 默认捕获并渲染红色错误占位（`errorColor`），不会让整条消息崩溃。AC3/AC4 由测试覆盖。
- **`$` 与货币文本冲突**：`remark-math` 要求 `$...$` 无前后空格的紧邻匹配，普通货币语句（`$5 和 $10`）大概率不触发；这是业界普遍接受的权衡，PRD 已接受。
- **`\[...\]` / `\(...\)` 定界符**：remark-math 不支持。若 agent 输出该形式仍显示原文。可选加预处理把 `\[`/`\(` 转成 `$$`/`$`（一个纯函数 + 测试）；纳入实现作为低风险增强，避免常见模型输出习惯导致"看起来还是没渲染"。

## 回滚

单 commit，revert 即可整体回滚；无数据迁移、无配置变更。
