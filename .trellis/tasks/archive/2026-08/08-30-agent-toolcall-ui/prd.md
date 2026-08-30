# Redesign agent tool call & thinking UI in chat

## Background

Litera 内嵌 agent runtime 的聊天界面中，thinking 块（`ThinkingBlock`）和工具调用卡片（`ToolCallCard`）目前是统一的灰底小方框：雪佛龙 + 图标 + 文本，展开后是纯文本 dump。视觉上显得粗糙，且缺乏状态表达（运行中/成功/失败）和流式反馈。

## Research Summary（业界参考）

调研了 Claude / ChatGPT（Deep Research）/ Cursor / Manus / DeerFlow 等 agent 应用的通行做法：

- **Collapsed trace 是默认选择**：单行摘要（"Thinking… 14s"），点击展开，完成后自动收起。多轮对话中历史 trace 默认折叠（Multigrid, Northbase）。
- **视觉层级必须弱于正文**：更低对比度、更小字号、缩进——思考内容绝不能被误读为回答。
- **工具调用卡片需要生命周期状态**：pending → running（动画指示）→ success（结果摘要）→ error（红色错误态），而非裸 JSON（uipotion AI Response Rendering Pattern）。
- **收起态显示"最后一步"**：如 DeerFlow 收起时显示当前正在执行的工具名 + shimmer 动画，实时更新。
- **运行中 shimmer/pulse 动画**传递"活着"的信号；完成后立即切换为静态状态（✓ / ✗）。
- **结果展示需要约束**：默认折叠、截断有标注、可滚动（Northbase: "collapsed by default, truncation labeled, scrollable in place"）。
- **流式体验**：thinking 流式输出时自动展开、batch 渲染（50-100ms），streaming 结束后自动收起（现有行为，保留）。

## Requirements

1. **ThinkingBlock 重设计**
   - 收起态为一行：脑图标 + "思考过程" + 流式时显示动态效果（shimmer/pulse）
   - 视觉弱化：低对比度、小字号，与正文明确区分
   - 流式时自动展开、结束后自动收起（保留现有行为）
   - 展开内容限制最大高度，可滚动

2. **ToolCallCard 重设计**
   - 生命周期状态可视化：运行中（spinner/呼吸动画）、成功（✓ 或中性静态）、失败（红色 + 错误标识）
   - 收起态显示工具名 + 参数摘要（现有）+ 状态图标
   - 展开态：结果限高滚动，长结果截断并有标注，提供"复制结果"按钮
   - 人类可读的工具名/参数摘要而非原始 JSON

3. **统一视觉语言**
   - 两类块采用一致的圆角、间距、边框、hover 行为
   - 适配 dark mode（项目已有 dark:prose-invert 等）
   - `prefers-reduced-motion` 下禁用动画

4. **不改变**：block 数据流（`agent-reducer.ts`）、消息渲染顺序逻辑、i18n 机制（新增 key 走 locales/en.ts + zh-CN.ts）。

## Acceptance Criteria

- [ ] Thinking 收起态单行 + 弱化视觉；流式时展开、结束自动收起（现有测试不回退）
- [ ] ToolCallCard 有明确的 running / success / error 三态视觉
- [ ] 展开 tool call 结果：限高滚动 + 复制按钮
- [ ] Dark mode 下视觉正确
- [ ] `prefers-reduced-motion` 下无动画
- [ ] 现有测试（AssistantMessage.test.tsx 等）通过，并为新状态补测试
- [ ] `npm run build` 通过

## Out of Scope

- 不改 agent-reducer / 后端事件协议
- 不做工具调用的结构化渲染（如表格、diff 视图）
- 不做子代理/subtask 编排 UI
