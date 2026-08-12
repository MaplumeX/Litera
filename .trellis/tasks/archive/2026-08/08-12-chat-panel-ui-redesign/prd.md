# 优化阅读助手聊天面板 UI 设计

## Goal

将阅读助手聊天面板(ChatPanel)的视觉与交互设计提升到市面主流 AI 聊天产品(ChatGPT、Claude 等)的水平,同时保持 Litera 现有的 shadcn/ui 中性色设计语言与三主题(light/dark/sepia)兼容。

**用户价值**:更清晰的消息层次、更顺畅的输入与反馈体验、更精致的空状态引导,让"边读书边问 AI"的体验更接近主流聊天产品。

## Background / Confirmed Facts(代码证据)

- 目标文件:`src/components/ChatPanel.tsx`(单文件 ~430 行),挂载于 App.tsx:482,是 ReaderView 右侧的可伸缩面板(宽度可变,可能较窄)。
- 现有实现:
  - 头部:会话列表按钮 + "阅读助手"标题 + 状态文字 + 设置按钮(`MessagesSquare`/`Settings`/`RefreshCw` 图标按钮)。
  - 用户消息:`bg-primary/10` 圆角块,左侧对齐;选中段落以 `border-l-4` 引用块显示在消息上方;hover 显示编辑按钮(Pencil)。
  - 助手消息:裸 markdown 文本(`prose prose-sm`),无气泡/无头像;hover 显示复制按钮(CopyButton)。
  - 工具调用:`ToolCallCard` — 🔧 emoji + 可折叠卡片(违规范:component-guidelines 明确禁用 emoji 作为 UI 内容)。
  - 输入区:普通 2 行 textarea + 右下角"发送"按钮;无提示文案、无自动增高。
  - 空状态:一行小字"打开一本书,选中段落或直接提问。"。
  - 流式生成中:无任何 typing/生成指示,仅"停止"按钮出现。
  - 错误:红底小条 `⚠ {error}`(emoji 前缀)。
  - 会话列表:覆盖式面板,含新建会话、重命名、删除。
- 设计体系约束:
  - shadcn/ui + Tailwind v4;主题变量 oklch,三主题 `:root` / `.dark` / `.sepia`。
  - 组件规范:图标按钮必须用 lucide 图标 + `aria-label`;禁用 emoji(☰⚙📖🔧⚠);新交互组件优先用 shadcn 组件。
  - 状态管理:Agent 状态经 `useAgentBridge` reducer;ChatPanel 持 UI 瞬时状态。无全局状态库。
- 已有 shadcn 组件:button、dialog、select、input、label(无 textarea、tooltip、avatar、dropdown-menu)。

## Requirements

### R1 消息布局与层次(方案 A:ChatGPT 式)

- 用户消息:**右对齐主色气泡**(`bg-primary text-primary-foreground`),最大宽度约 85% 面板宽,圆角;引用选段作为气泡上方的紧凑引用小卡片(右对齐,或并入气泡内顶部)。
- 助手消息:**左对齐**,带 AI 身份头像(lucide `Bot` 图标置于圆形底块中),内容占约 90% 宽度;无底色气泡、文档流式排版(markdown)。
- 保持 hover 交互:用户消息可编辑、助手消息可复制。

### R2 输入区升级

- 输入框改为大圆角(radius-xl 级别)、有边框/底色的文本区,发送按钮内置在输入区内(右下角),参考 ChatGPT 式布局。
- 输入框支持自动增高(随内容行数增高,设上限),默认 1 行。
- 显示交互提示文案(如"Enter 发送 · Shift+Enter 换行"),仅作视觉提示。
- 停止生成按钮在流式期间出现在输入区附近(替代/配合现有按钮)。
- 引用选段提示条视觉升级(与 R1 引用卡片风格一致)。

### R3 空状态与引导

- 无消息时显示欢迎空状态:AI 图标 + 欢迎语 + 简短能力说明,替代当前一行小字。
- 提供 2-3 个基于当前书籍上下文的建议提问(前端静态生成,如"总结本章内容"、"解释选段含义"),点击后填入输入框(有选段时优先引用选段)。
- 未配置 provider 的警告条保留,但样式与新的视觉风格统一。

### R4 生成状态反馈

- 流式等待期间显示生成指示(如三点跳动动画),替代/强化当前仅"停止"按钮的反馈。
- 最后一条助手消息处于生成中时,有可见的流式光标或持续动画标识。

### R5 工具调用卡片

- 移除 🔧 emoji,改用 lucide `Wrench` 图标(或行内 chip 样式)。
- 卡片折叠交互保留,视觉与消息卡片体系统一(配色、圆角、边框)。

### R6 会话列表

- 保持功能不变(新建/切换/重命名/删除),视觉与新风格统一(列表项 hover/active 态、时间显示)。
- 可选:仅当成本低时优化,不作为本轮重点。

### R7 错误提示

- 移除 ⚠ emoji,改用 lucide `AlertCircle`/`AlertTriangle` 图标。
- 错误条样式统一到新视觉体系。

### 全局约束

- 所有改动兼容 light/dark/sepia 三主题(只用主题变量,不硬编码颜色)。
- 不用 emoji 作为 UI 内容,图标一律 lucide + `aria-label`。
- 不改变 agent 交互逻辑(发送/停止/会话切换/sidecar 协议),仅视觉与局部交互呈现;若发现逻辑缺陷,记录而不顺手改。
- 组件拆分:`ChatPanel.tsx` 若超过可维护规模,可将消息、输入区、会话列表拆为同目录子组件文件,但保持对外 props/handle 契约(`ChatPanelHandle.fillInput`)不变。

## Acceptance Criteria

- [ ] 用户消息与助手消息在视觉上明显可区分;助手消息有 AI 身份标识。
- [ ] 输入框为大圆角样式,发送按钮内置;Enter 发送、Shift+Enter 换行行为不变;输入框随内容自动增高且有上限。
- [ ] 空状态显示欢迎界面 + 至少 2 个建议提问;点击建议可填入输入框并聚焦。
- [ ] 流式期间有可见的生成中指示;消息生成完成后指示消失。
- [ ] 全 UI 无 emoji 图标内容(文案文字中的 emoji 除外);所有图标按钮有 aria-label。
- [ ] `npm run build`(tsc + vite)通过;`npm test` 现有测试全部通过。
- [ ] 三主题下人工检查无明显对比度/配色问题(light/dark/sepia 各截图确认)。
- [ ] `ChatPanelHandle.fillInput` 契约不变,选中段落→提问的既有流程可用。

## Out of Scope

- Agent 交互逻辑/sidecar 协议的改动。
- AgentConfigDialog 与 SettingsDialog 的 UI 优化(仅 ChatPanel 内引用的入口按钮样式可微调)。
- 会话标题自动生成、消息持久化搜索等新功能。
- 新 shadcn 组件若需要,可引入(如 tooltip),但避免为纯装饰引入重量级依赖。

## Decisions

- D1:消息布局 = 方案 A(ChatGPT 式右对齐用户气泡 + 左对齐带头像助手消息),用户拍板。
- D2:助手身份头像 = lucide `Bot` 圆形底块(推荐;实施时可与 `Sparkles` 对比微调,评审时确认)。
- D3:建议提问 = 3 条,前端静态生成,随上下文变化:
  - 有选段:"解释这段文字" / "这段表达了什么观点" / "用更简单的话复述"
  - 无选段、已开书:"总结本章内容" / "这本书主要讲了什么" / "帮我梳理本节要点"
  - 未开书:仅欢迎语,不显示建议(输入框本就禁用)。
- D4:配色保持 shadcn 中性主题 token(primary/muted/border),不引入 ChatGPT 绿等品牌色。
