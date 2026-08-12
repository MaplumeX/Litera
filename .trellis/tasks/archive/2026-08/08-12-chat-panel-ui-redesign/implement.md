# Implement — ChatPanel UI 重设计

## 执行顺序(每步可独立验证)

1. **组件拆分(骨架)** — 建 `src/components/chat/` 子目录,将 `ChatPanel.tsx` 拆为容器 + 子组件(按 design.md 结构)。此步先**保功能**,不做视觉改动:`npm run build` + `npm run dev` 确认面板行为与拆前一致。App.tsx import 路径同步更新。
2. **消息气泡(R1)** — 用户右对齐 primary 气泡(含引用小卡片、编辑按钮配色)、助手头像 + 左对齐流;间距 space-y-4。
3. **输入区(R2)** — 大圆角容器、自动增高 textarea、内置发送/停止按钮、提示文案、引用条卡片化。
4. **空状态(R3)** — 欢迎界面 + 3 条上下文建议提问;provider 警告条加 AlertCircle。
5. **生成指示(R4)** — TypingIndicator 三点动画 + 流式光标;keyframes 加入 index.css。
6. **emoji 清理(R5/R6/R7)** — ToolCallCard 换 Wrench/ChevronRight;错误条换 AlertCircle;会话列表 ✕/+ 换 lucide 图标。
7. **全量验证** — build + test + 三主题人工检查。

每步完成后 `npm run build` 必须通过;步骤 1 和 7 额外跑 `npm test`。

## 验证命令

```bash
npm run build          # tsc + vite build(每步)
npm test               # vitest(步骤 1、7)
npm run dev            # 人工检查(步骤 2-6 边做边看;步骤 7 三主题完整走查)
```

## 人工检查清单(步骤 7)

- [ ] light/dark/sepia 三主题切换:消息气泡、输入区、空状态、错误条对比度正常
- [ ] 打开书 → 选中段落 → 引用卡片出现 → 提问 → 用户气泡右对齐 + 引用小卡片
- [ ] 助手回复流式期间:三点动画 + 光标 + 内置停止按钮;完成后动画消失
- [ ] Enter 发送、Shift+Enter 换行;输入多行自动增高至上限后滚动
- [ ] 空状态建议点击 → 填入输入框并聚焦;有选段时带引用
- [ ] 编辑用户消息(hover)、复制助手消息(hover)、工具卡片折叠
- [ ] 会话列表新建/切换/重命名/删除正常
- [ ] 未配置 provider 警告条 + 打开设置入口正常

## 风险文件

- `src/components/ChatPanel.tsx`(→ `src/components/chat/`)— 大改文件,effects/callbacks 原样搬运,不顺手重构。
- `src/App.tsx` — 仅 import 路径(若走子目录方案)。
- `src/index.css` — 仅追加 keyframes,不动主题变量。

## 回滚点

- 每步一个 commit;步骤 7 通过后任务完成,失败则 revert 对应步骤 commit。
- 若步骤 1 移动后出现不可接受的复杂度,退化为"ChatPanel.tsx 原地 + 同目录子组件"(design.md 备选),App.tsx 不动。

## 注意事项

- 不改 agent 逻辑与 sidecar;发现逻辑缺陷仅记录到 prd Notes,不在本任务顺手修。
- 图标一律 lucide + aria-label;禁用 emoji 字符(✕/▶/▼/+ 字符按钮全部替换)。
- Tailwind 4 语法:`focus-within:ring-1` 等;自动增高用 scrollHeight 方案(design.md),不引第三方 autosize 库。
