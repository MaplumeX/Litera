# Design: agent tool call & thinking UI 重设计

## 现状

- `src/components/chat/AssistantMessage.tsx` — `ThinkingBlock`（灰框 + 雪佛龙 + Brain 图标，展开纯文本）
- `src/components/chat/ToolCallCard.tsx` — 灰框 + Wrench 图标 + `tool(params...)` 一行，展开 dump 结果
- 数据层：`src/types/agent.ts`（`AgentToolCall { toolCallId, tool, params, done, result, isError }`）、`src/lib/agent-reducer.ts`
- 测试：`src/components/chat/AssistantMessage.test.tsx`

## 设计方向

参考 Claude（collapsed trace 单行摘要）+ DeerFlow（收起态显示最后一步 + 状态图标）+ uipotion（生命周期状态卡）的融合方案：

### 1. ThinkingBlock

```
收起（完成后）:
  ◦ 思考过程                    [chevron]
运行中（流式）:
  ✦ 思考过程 ▂▃▂ (shimmer 文字)  [chevron, 自动展开]
```

- 容器：无边框、透明背景（或极淡 `bg-muted/30`），左侧细竖线（`border-l-2 border-muted-foreground/20 pl-3`）标记"这是过程而非答案"
- 文字 `text-xs text-muted-foreground/70 italic`，运行中标题 shimmer 动画（`animate-pulse` 或自定义 shimmer）
- 展开内容：`max-h-60 overflow-y-auto`，`text-xs text-muted-foreground/70 whitespace-pre-wrap`
- 保留：流式自动展开 → 结束自动收起（`active` prop 机制不变）

### 2. ToolCallCard

生命周期三态（数据层已有 `done` / `isError`）：

| 状态 | 判定 | 视觉 |
|---|---|---|
| running | `!done` | 标题 shimmer/pulse + Loader2 旋转图标 |
| success | `done && !isError` | 静态，工具图标 + ✓（绿色/中性） |
| error | `done && isError` | `text-destructive` + 红色边框提示 |

- 收起态一行：状态图标 + 工具名（`font-medium`）+ 参数摘要（`truncate text-muted-foreground`）
- 展开态：
  - 参数区（labelled fields 或紧凑 JSON）
  - 结果区：`max-h-60 overflow-y-auto` + 超过阈值（~2000 字符）截断标注 + 复制按钮
- 容器与 ThinkingBlock 同语言：细竖线方案或统一 `rounded-md bg-muted/30 hover:bg-muted/50`，取竖线方案保持极简

### 3. 动画与可访问性

- 所有动画挂 `motion-reduce:animate-none`
- 展开收起用简单的条件渲染 + CSS transition（不引入额外依赖）
- aria-expanded 已有，保留

## 组件改动清单

| 文件 | 改动 |
|---|---|
| `src/components/chat/ToolCallCard.tsx` | 重写视觉：三态、结果限高/截断/复制 |
| `src/components/chat/AssistantMessage.tsx` | ThinkingBlock 重写视觉（结构基本不变） |
| `src/locales/en.ts` / `zh-CN.ts` | 新增 key：截断提示、复制结果、错误标签等 |
| `src/components/chat/AssistantMessage.test.tsx` | 补三态、截断、复制按钮测试 |

## 权衡

- **竖线方案 vs 卡片方案**：竖线（Claude 风）更极简、与正文区分强，符合"视觉弱化"研究结论；卡片方案状态感更强。选竖线 + 状态图标的混合。
- **不引入语法高亮库**：结果多为 markdown/纯文本，保持 `whitespace-pre-wrap` + mono 字体即可，避免依赖膨胀。
- **不合并 thinking+toolcall 进单一折叠面板**：现有 reducer 按 block 顺序输出，保留顺序渲染（PRD 明确不改数据流）。
