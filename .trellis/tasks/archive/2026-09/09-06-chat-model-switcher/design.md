# Design: Chat quick model switcher

## Goals

- 输入区一键切换当前 provider 的模型，不打开配置对话框
- 与 thinking level 选择器同排、同视觉语言（无边框小号 Select/Popover）
- 复用现有 `switch_provider` 命令与 `useAgentConfig().switchProvider`

## Non-goals

- 跨 provider 切换（走 AgentConfigDialog）
- `/model` 斜杠命令
- 远端 `/models` 拉取（spec 禁止 WebView 直连；内置 provider 用 pi-ai 静态 catalog）

## Component: `ModelSwitcher`

新文件 `src/components/chat/ModelSwitcher.tsx`。

```
Props:
  provider: string | null        // snapshot.provider
  model: string | null           // snapshot.model
  configured: boolean
  isStreaming: boolean
  onModelSelect: (model: string) => void   // ChatPanel 调 switchProvider
  onOpenConfig: () => void       // 未配置时引导
```

UI 形态（复用 `src/components/chat/ChatInput.tsx` 中 thinking level `Select` 的样式 token：`h-6 w-auto border-none bg-transparent text-[10px] text-muted-foreground`）：

- trigger：当前模型名（长 id 截断 + title 提示）+ chevron-down
- 点击弹 `Popover`（`modal={false}`，`side="top" align="start"`），内容为模型列表：
  - 内置 provider：`builtinCatalog(provider)` 的模型 id 列表（按 catalog 顺序），每项 mono 字体
  - 自定义 provider：该 entry 的 `models` 数组
  - 当前模型项带 `Check` 图标
  - 当前模型不在列表中时（free-text 配置的历史值）追加显示在最上方，同样可选
- 列表超过 ~12 项时容器 `max-h` + 滚动（不引入搜索，控制范围）
- 未配置：trigger 显示 `chat.modelNotConfigured` 文案，点击 `onOpenConfig`
- `isStreaming` 时 disabled

### 模型列表来源

`src/agent/runtime/model-resolution.ts` 导出新函数：

```ts
export async function listBuiltinModelIds(provider: string): Promise<string[]>
```

内部调 `builtinCatalog(provider)`，返回 `Object.keys(catalog)`（保持 catalog 顺序）。未知 provider 返回 `[]`。不额外缓存（动态 import 本身有 module 缓存）。

### 与 spec 的关系

`component-guidelines.md` 的「LLM provider dropdown is draft-only」约定约束的是 `AgentConfigForm` 的草稿语义。`ModelSwitcher` 是显式的运行时切换入口（点击列表项 = 明确的切换意图，不是表单草稿变更），调用 `switch_provider` 是其设计目的。Phase 3.3 spec 更新时补充该例外与理由。

## Data flow

```
ModelSwitcher(select model)
  → ChatPanel.handleModelSelect(model)
    → useAgentConfig().switchProvider(provider, model)   // 已存在
      → invoke("switch_provider")                          // 已存在
      → embeddedAgentRuntime.invalidateConfig()             // hook 内已做
      → load()  // 刷新 snapshot，chip 更新
```

下一条消息发送时 runtime 读取新配置，落 `model_change` 时间线条目（现有行为）。

注意：`switchProvider` hook 需要当前 provider id。ChatPanel 从 `configSnapshot.provider` 取。`configured === false` 或 provider 为 null 时 ModelSwitcher 走引导分支，不会调 switch。

## Placement

`ChatInput` 底部工具行：`[ModelSwitcher] [thinking Select] [hint] ... [send/stop]`。ModelSwitcher 放最左（模型是更"重"的状态，thinking 是微调）。极窄面板下 hint 文案已有 `flex-1` 收缩空间，可再 `hidden sm:inline` 收敛——实现时按视觉需要决定。

`ChatInput` 增加 props：`provider/model/configured/onModelSelect/onOpenConfig`，或直接把 `ModelSwitcher` 作为 children/composed 由 ChatPanel 插入——**选择后者**：ChatInput 保持展示组件纯净，ChatPanel 组合。具体：ChatInput 接受可选 `leadingControls?: React.ReactNode` 插在工具行左侧。这样 ChatInput 的测试改动最小。

## Error handling

- `switchProvider` 失败：复用 hook 的 `error` 状态，ChatPanel 已有展示配置加载错误的机制则复用；无则在 ModelSwitcher trigger 旁短暂显示错误（实现时以最小方案为准，至少 console + 不崩溃）。

## i18n

`src/locales/en.ts` / `zh-CN.ts` 新增：
- `chat.modelLabel`（aria-label，如 "Model" / "模型"）
- `chat.modelNotConfigured`（"Set up model" / "配置模型"）
- `chat.switchModelFailed`（切换失败提示）

## Testing

- `ModelSwitcher.test.tsx`：渲染当前模型、列出内置/自定义模型、选中回调、当前项打勾、streaming 禁用、未配置引导
- `ChatInput.test`（如有）/`ChatPanel.test` 不回归；ChatInput 新增 leadingControls 插槽测试
- `model-resolution.test` 补 `listBuiltinModelIds`

## Rollback

纯前端增量（新增组件 + ChatInput 插槽 + model-resolution 导出），无数据迁移；revert 单个 commit 即可回滚。
