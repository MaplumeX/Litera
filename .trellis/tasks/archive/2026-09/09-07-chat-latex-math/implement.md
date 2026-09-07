# Implement — Agent chat LaTeX math rendering

## 执行清单（有序）

- [ ] 1. 安装依赖：`npm i remark-math rehype-katex katex`（注意走项目现有 npmmirror registry）。
- [ ] 2. `src/components/chat/AssistantMessage.tsx`：
  - 导入 `remarkMath`、`rehypeKatex`、`katex/dist/katex.min.css`
  - `TextBlock` 的 `<ReactMarkdown>` 加 `remarkPlugins={[remarkGfm, remarkMath]}`、`rehypePlugins={[rehypeKatex]}`
- [ ] 3. 加 `\[...\]`/`\(...\)` → `$$...$$`/`$...$` 定界符预处理纯函数（放在 AssistantMessage.tsx 内或紧邻的小工具），在传入 ReactMarkdown 前应用；注意不破坏代码块内的内容（实现时若与代码块冲突复杂，可降级为仅处理 `$$`/`$` 之外无转义的 `\[`/`\(` 行，或直接砍掉该项——见 design.md 风险节）。
- [ ] 4. KaTeX 溢出样式兜底：全局 CSS 加 `.katex-display { overflow-x: auto; overflow-y: hidden; }`（确认全局样式入口文件位置后落地）。
- [ ] 5. 测试（`src/components/chat/AssistantMessage.test.tsx` 扩展）：
  - AC1 行内公式 → 存在 `.katex` 节点且无原始 `$...$` 文本
  - AC2 块级公式 → 存在 `.katex-display`
  - AC3 残缺流式片段（`$\frac{` 未闭合 / `\frac{` 已闭合但残缺）不抛错
  - AC4 非法 LaTeX → 错误占位而非空白
- [ ] 6. 全量验证（见下）。

## 验证命令

```bash
npm run typecheck   # 或等价 tsc --noEmit（以 package.json scripts 为准）
npm test            # vitest，重点 AssistantMessage.test.tsx
npm run build       # tsc + vite build，确认 katex CSS/字体进产物
```

## 风险文件 / 回滚点

- 唯一产品代码改动文件：`src/components/chat/AssistantMessage.tsx`（+ 一处全局 CSS）。
- 回滚：单 commit revert。
- 注意：`AssistantMessage.test.tsx` 现有 jsdom 环境，KaTeX 渲染纯 DOM 操作无 canvas 依赖，jsdom 可跑。

## task.py start 前检查

- prd / design / implement 齐备（本任务小而清晰，按复杂任务三件套备齐以稳妥起见）。
- implement.jsonl / check.jsonl 已填入真实 spec 条目（frontend/component-guidelines.md 等）。
