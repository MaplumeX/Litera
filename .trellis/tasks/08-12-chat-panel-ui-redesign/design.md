# Design — ChatPanel UI 重设计

## Architecture & Boundaries

### 组件拆分

`ChatPanel.tsx` 目前 ~430 行,本轮改动后预计 +300 行。拆分为同目录子组件,保持 `ChatPanel` 对外契约不变:

```
src/components/chat/
├── ChatPanel.tsx          # 容器:状态/逻辑保留,编排子组件(从 src/components/ChatPanel.tsx 移入)
├── MessageBubble.tsx      # 用户消息气泡(含引用小卡片、编辑按钮)
├── AssistantMessage.tsx   # 助手消息(头像 + markdown + 复制按钮 + 流式光标)
├── ToolCallCard.tsx       # 工具调用折叠卡片(Wrench 图标)
├── ChatInput.tsx          # 输入区(自动增高 textarea、内置发送/停止、提示文案、引用条)
├── EmptyState.tsx         # 欢迎空状态 + 建议提问
├── SessionList.tsx        # 会话列表覆盖面板
└── TypingIndicator.tsx    # 三点跳动生成指示
```

> 移入子目录的代价:App.tsx 的 import 路径需改为 `@/components/chat/ChatPanel`。若实施时发现移动成本高于收益,允许退化为"ChatPanel.tsx 原地 + 同目录子组件文件"(对外路径不变)。两种方案对外 props/handle 契约均不变。

**契约不变**(App.tsx:482 与 ReaderView 的调用方):
- `ChatPanelHandle.fillInput(text, chapterIndex)` — 填充引用并聚焦。
- Props:`currentChapterIndex`、`bookId`、`onOpenSettings`。

**逻辑不动**:useAgentBridge 状态、发送/停止/会话切换、自动切换会话、abort 恢复等 effect 全部原样保留;仅渲染层(JSX/className)与少量纯呈现状态(如 input 高度)变更。

## Visual Spec(方案 A:ChatGPT 式)

### 消息区

| 元素 | 规格 |
|---|---|
| 用户消息 | 右对齐,`bg-primary text-primary-foreground` 气泡,`rounded-2xl`,max-w-[85%],`px-3 py-2`;首尾圆角按对话连续性处理可简化(固定 rounded-2xl) |
| 用户引用选段 | 气泡**上方**右对齐紧凑卡片:`rounded-lg border bg-card/80 px-3 py-1.5 text-xs italic text-muted-foreground`,max-w-[85%],带 `Quote` 图标 |
| 助手消息 | 左对齐:`flex gap-2`;头像 = 24px 圆形块 `bg-muted` 内 `Bot` h-4 w-4,消息列 max-w-[90%] |
| 助手 markdown | `prose prose-sm max-w-none dark:prose-invert`(保持),复制按钮 hover 显示(保持) |
| 消息间距 | `space-y-4`(原 space-y-3,拉开层次) |
| 编辑按钮 | 用户气泡 hover 显示,`text-primary-foreground/70 hover:text-primary-foreground`(随气泡配色) |

### 输入区(底部)

- 容器:`mx-2 mb-2 rounded-2xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring`
- 引用选段条:输入区上方贴片(`border-t` 小条升级为卡片,`rounded-lg bg-muted/50 px-3 py-1.5 text-xs`,含 `Quote` 图标与 ✕ 关闭按钮——**关闭按钮用 lucide `X`,不用 ✕ 字符**)
- textarea:borderless(`border-0 outline-none ring-0`),`rows=1`,自动增高:
  ```tsx
  const resize = () => { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; };
  useEffect(resize, [input]);
  ```
- 发送按钮:右下角内置,`size="icon-sm"`,生成中切换为停止按钮(`Square` 图标,替代/并存现有"停止"文字按钮——**方案:流式时该按钮变为停止按钮,移除原文字按钮**)
- 提示文案:底部居中小字 `text-[10px] text-muted-foreground`:"Enter 发送 · Shift+Enter 换行"
- 禁用态(无书/生成中):textarea disabled + 按钮禁用(保持现有 disabled 逻辑)

### 空状态

- 居中纵向:`Bot` 图标 40px 圆形块(`rounded-full bg-muted`)+ 标题"阅读助手" + 说明("打开一本书,选中段落或直接提问。")
- 建议提问:说明下方竖向堆叠的 `Button variant="outline" size="sm" justify-start` 列表(3 条),点击调用既有 fillInput 逻辑:
  - 有选段:`fillInput("解释这段文字", chapterIndex)` 等(复用 pendingSelection)
  - 无选段、有书:普通 `setInput` + focus
- 未配置 provider 警告条:保留,加 `AlertCircle` 图标(替代无图标的纯文字),样式微调统一。

### 生成状态

- TypingIndicator:助手消息流首部(最后一条消息且 `state.status === "prompting"` 时)显示三点动画:
  ```css
  @keyframes chat-typing { 0%,60%,100% {opacity:.25; transform:translateY(0)} 30% {opacity:1; transform:translateY(-2px)} }
  ```
  三点 `h-1.5 w-1.5 rounded-full bg-muted-foreground` 依次 `animation-delay: 0/.15/.3s`。keyframes 加到 `index.css`(主题无关,无需变量)。
- 流式光标:最后一条助手消息有内容且生成中时,尾部追加 `<span class="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70">` 模拟光标。
- `isStreaming` 判定沿用现有 `submitting || state.status === "prompting"`。

### 工具调用卡片

- 头行:`Wrench` 图标(`h-3.5 w-3.5 text-muted-foreground`)+ 工具名 + 参数摘要,`▶/▼` 改用 `ChevronRight` 旋转(`transition-transform` + expanded 时 rotate-90)。
- 样式沿用:`rounded border bg-muted/50 text-xs`(微调间距即可)。

### 错误提示

- `⚠ {error}` → `AlertCircle` 图标 + 文本的 flex 行;红底条样式保留(destructive token)。

### 会话列表

- 功能不变;视觉统一:新建会话按钮 `justify-start` + `Plus` 图标(替代 "+"字符),删除"文字按钮保留(有 aria 语义即可),✕ 关闭按钮改 `X` 图标。时间显示保持。

## Data Flow & Contracts

- 无新数据流。建议提问为静态文案 + 复用 `fillInput`/`setInput`。
- `ChatInput` 子组件 props:`value, onChange, onSend, onStop, disabled, isStreaming, pendingSelection, onClearSelection, bookReady, retryHighlight`;或用回调组合,实施时取最简形态。
- `EmptyState` props:`configured: boolean`, `hasSelection: boolean`, `bookReady: boolean`, `onSuggestion(text, useSelection)`, `onOpenSettings`。

## Trade-offs

1. **用户气泡用 primary(黑/白)而非品牌色**:放弃 ChatGPT 绿/Claude 橙等品牌色,换取三主题一致性与中性书卷气质(PRD D4)。sepia 主题下 primary 为深棕,气泡对比度良好。
2. **右对齐气泡 max-w-85%**:窄面板下用户长问题折行更早;通过 max-width 约束避免气泡贴边,编辑/引用卡片同样约束宽度。
3. **子目录移动 vs 原地拆分**:子目录更整洁但动 import;原地退化方案已备。
4. **tooltip 不引入**:编辑/复制按钮已有 aria-label,不新增依赖。

## Rollback

- 纯前端组件渲染层改动,无协议/后端/sidecar 变更。git revert 单 commit 即可完整回滚。
- 风险点:`ChatPanel.tsx` 大改时逻辑 effect 误伤。缓解:逻辑代码块(effects/callbacks)原样搬运,子组件只接收渲染所需 props;`npm run build` + `npm test` + 手动三主题检查兜底。

## Compatibility

- 三主题:全部颜色走 token(primary/primary-foreground/muted/border/destructive/ring),keyframes 动画无色值。
- 现有测试(lib 层)不涉及组件;不新增组件测试(手工验证 + 截图确认)。
