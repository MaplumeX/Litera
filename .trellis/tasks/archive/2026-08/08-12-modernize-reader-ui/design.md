# 设计文档:现代化阅读器 UI 重构

## 架构与边界

本次重构**仅触及 UI 层**(React 组件),不涉及 Rust 后端、foliate-js 内核、IPC 契约或数据模型。改动集中在 5 个文件:

| 文件 | 改动范围 |
|------|----------|
| `src/App.tsx` | 阅读器顶栏图标化 + 分组;删除底栏 footer;进度信息移入顶栏 |
| `src/components/ChatPanel.tsx` | 聊天面板头部按钮图标化;状态文字弱化 |
| `src/components/ReaderControls.tsx` | 触发器已在外部(App.tsx),面板内部无改动(可选微调) |
| `src/components/LibraryView.tsx` | 导入按钮加图标 |
| `src/components/ui/button.tsx` | 不改(已支持 icon 变体) |

布局容器(`react-resizable-panels` Group/Panel)不变,仅改头尾。

## 数据流与契约

无新增数据流。现有契约保持:
- `handleRelocate(index, fraction, label)` → App state `progress` → 顶栏进度条读取
- `styleState` → `ReaderControls` 面板,不变
- `readerRef.current.prev/next()` → 仍由键盘事件调用,不暴露按钮

### 进度条组件(新增,内联于 App.tsx)
```
ReaderProgressBar({ fraction, chapterLabel })
  ├─ <div className="flex-1 h-1 rounded bg-muted">
  │    <div style={{ width: `${fraction*100}%` }} className="h-full bg-primary rounded" />
  └─ <span className="text-xs text-muted-foreground tabular-nums">{chapterLabel} · {pct}%</span>
```
细条 + 文字,放在顶栏右侧按钮组左边。不做成可拖动(MVP 范围外)。

## 详细设计

### D1 阅读器顶栏(App.tsx)

```
┌─────────────────────────────────────────────────────────┐
│ [←]  Litera · 书名            [▰▰▰▱▱ 42%] [☰][A][💬]    │
│  返回组   书名(中间,truncate)   进度   操作组(图标)      │
└─────────────────────────────────────────────────────────┘
```

- 左侧:`<Button variant="ghost" size="icon-sm"><ChevronLeft/></Button>` + `aria-label="返回书库"`
- 中间:`<h1>` + 书名 span,`flex-1 truncate`,居中靠左
- 右侧组(在一个 `<div className="flex items-center gap-1">` 内):
  - 进度条(细条 + 文字)
  - 目录按钮:`<Button variant={tocVisible?"secondary":"ghost"} size="icon-sm"><List/></Button>` + `aria-label="目录"`
  - Aa 按钮:`<Button variant={controlsOpen?"secondary":"ghost"} size="icon-sm"><Type/></Button>` + `aria-label="字体与主题"`
  - 对话按钮:`<Button variant={chatCollapsed?"outline":"ghost"} size="icon-sm"><MessageSquare/MessageSquareOff/></Button>` + `aria-label="显示/隐藏对话"`
- 激活态用 `variant="secondary"`(背景色高亮),非激活用 `variant="ghost"`

### D2 底栏移除

删除 `App.tsx` 中的整个 `{fileData && (<footer>...</footer>)}` 块。阅读器 Panel 区域获得全部剩余高度。

### D3 翻页:键盘事件

在 `App.tsx` 添加 `useEffect` 监听 `keydown`:
- `ArrowLeft` → `readerRef.current?.prev()`
- `ArrowRight` → `readerRef.current?.next()`
- 仅 `view === "reader"` 且 `fileData` 存在时生效
- 不阻止默认行为(避免拦截输入框内 ←/→;用 `e.target` tag 判断,仅在非 input/textarea 时响应)

foliate 自身已支持滚轮翻页和点击区域(页边),无需额外处理。

### D4 聊天面板头部(ChatPanel.tsx)

```
┌─────────────────────────────────┐
│ [☰] 阅读助手          [⚙]      │
│  会话图标  标题        设置图标  │
└─────────────────────────────────┘
```
- `☰ 会话` → `<Button variant="ghost" size="icon-xs"><MessagesSquare/></Button>` + `aria-label="会话列表"`
- `⚙ 设置` → `<Button variant="ghost" size="icon-xs"><Settings/></Button>` + `aria-label="设置"`
- `重启助手` → `<Button variant="outline" size="icon-xs"><RefreshCw/></Button>` + `aria-label="重启助手"`
- 状态文字("📖 已就绪"/"等待书籍…")→ 保留但降级为 `text-[10px] text-muted-foreground`,放在标题右侧或标题下方,不与按钮同行
- 移除 emoji 字符,改用 lucide 图标(设置/重启场景)

### D5 书库工具栏(LibraryView.tsx)

- "导入"按钮:`<Button size="sm"><Plus/Upload/><span>导入</span></Button>` —— 图标 + 文字(书库主操作,保留文字增强发现性)

## 图标清单(lucide-react)

| 用途 | 图标名 |
|------|--------|
| 返回书库 | `ChevronLeft` |
| 目录 | `List` |
| 字体主题 | `Type` |
| 显示对话 | `MessageSquare` |
| 隐藏对话 | `MessageSquareOff` |
| 会话列表 | `MessagesSquare` |
| 设置 | `Settings` |
| 重启助手 | `RefreshCw` |
| 导入 | `Plus` |

共 9 个图标,满足验收"至少 5 个"。

## 兼容性与回滚

- 纯前端改动,无数据迁移
- 回滚:`git revert` 单次 commit 即可
- 风险点:键盘事件监听需正确清理;`e.target` 判断避免拦截输入框
- 无新依赖(lucide-react 已在 package.json)

## 交互权衡

- 失去显式翻页按钮的发现性 → 用 `aria-label` + 键盘提示弥补;foliate 点击区域翻页是行业标准行为
- 进度条不可拖动 → MVP 范围外,后续可加;当前只读展示