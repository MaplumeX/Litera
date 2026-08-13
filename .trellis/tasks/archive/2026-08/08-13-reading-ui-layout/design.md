# Design: reading UI layout (option B)

## Boundaries

只改阅读页 React 布局。不改 Rust、sidecar、偏好 schema、foliate 内核、书库页、Chat 消息内部样式。

| 文件 | 改动 |
|------|------|
| `src/App.tsx` | 顶栏、进度条位置、目录改为 overlay、对话默认收起、进程内记住开关、「问 agent」先开再填 |
| `src/components/TocSidebar.tsx` | 作为抽屉内容；点击项后关闭由 App 处理 |
| `src/components/chat/ChatPanel.tsx` | 契约不变；如需挂载后消费 pending 选段则加最小 prop |
| `src/components/ReaderView.tsx` | 原则上不改；选段按钮仍回调 `onSelectionCapture` |

不新增 shadcn Sheet，除非现有 Dialog 明显不够。抽屉用绝对定位 + 可选遮罩即可。

## Layout

```
header:  [←]  书名(flex-1 truncate)     [目录][字体][对话]
progress: ================= 第3章 · 42% =================
body:     [TOC overlay]  Reader  |  Chat (optional)
```

- 阅读页去掉 `Litera` 标题。书名用 `h1` + `truncate`。
- `ReaderProgressBar` 从顶栏右侧挪到 header 下方通栏：细条全宽，右侧或条上叠章节 · 百分比。保持不可拖。
- 图标组 `gap-1`。`tocVisible` / `!chatCollapsed` / `settingsOpen` 用 `secondary`，否则 `ghost`。对话不再用 `outline` + `MessageSquareOff` 反语义；开着 `secondary` + `MessageSquare`，关着 `ghost` + `MessageSquare`。

## TOC overlay

- 不要再渲染成 `w-56 shrink-0` 第三列。
- 阅读区 `relative`；`tocVisible` 时左侧绝对定位抽屉（约 `w-56`）盖在 `ReaderView` 上，`z-index` 高于正文、低于 Dialog。
- 半透明遮罩点击关闭。Esc 关闭（仅目录开着且焦点不在输入框时）。
- `onGoTo`：先 `goToTocItem`，再 `setTocVisible(false)`。
- 抽屉打开时正文仍可被遮罩挡住，不改变 foliate 宽度，避免重排。

## Chat panel

### Default and process memory

- `chatCollapsed` 初值改为 `true`。
- `handleBackToLibrary` **不要**重置 `chatCollapsed` / `tocVisible`（现在会清 `tocVisible`，要删掉）。换书也不重置。
- 进程重启 = 组件树重建 = 回到默认。不写 `save_preferences`。

### Keep ChatPanel mounted

折叠时不要卸载 `ChatPanel`（现状两套 `ReaderView` 分支会卸面板，导致 `fillInput` 失效、会话 UI 重挂载）。

做法：始终挂 `Group` + 两个 `Panel`。折叠时用 `react-resizable-panels` 的 collapse API，或给对话 `Panel` `defaultSize={22}` 并在收起时把 Group 换成「仅阅读区」但 **ChatPanel 仍挂在隐藏容器**（`hidden` / `sr-only` 以外的 `hidden` 即可，避免重复订阅）。

推荐更简单、少踩 panel API 的路径：

- 收起：阅读区全宽；`ChatPanel` 留在 `hidden` 的同级节点（`hidden h-full`），`bookId` 仍传入，bridge 保持。
- 打开：`Group` 里 `Panel` 默认 `78 / 22`（或 `75 / 25`），`minSize` 阅读 ≥ 40、对话 ≥ 18。
- `ReaderView` 只挂一份，避免折叠切换时 foliate 重开书。

`ReaderView` 必须始终只 mount 一次：把现在 `chatCollapsed ? … : …` 的两份 `ReaderView` 收成一份。

### 「问 agent」sequence

`handleSelectionCapture`：

1. 若 `chatCollapsed`，`setChatCollapsed(false)`。
2. `fillInput`。若本帧 `chatRef` 因刚从 hidden 显示而尚未就绪，把 capture 放进 `pendingCaptureRef`，`useEffect` 在 `!chatCollapsed` 后调用一次并清空。

不要把选段丢进已卸载实例。

## State

仍只放 `App.tsx` local state。不新增 Context、不改偏好 schema。

| 状态 | 初值 | 回书库 | 换书 | 重启 |
|------|------|--------|------|------|
| `tocVisible` | `false` | 保持 | 保持 | 默认 |
| `chatCollapsed` | `true` | 保持 | 保持 | 默认 |
| `toc` 数据 | `[]` | 清空 | 由 `onBookReady` 替换 | — |

`toc` 数据仍随书清空/重填；只记住「抽屉开没开」。

## Compatibility

- `ChatPanelHandle.fillInput` 签名不变。
- `SettingsDialog` / `AgentConfigDialog` 入口不变。
- 键盘翻页、进度持久化、`setStyles` 时机不变。

## Trade-offs

- 隐藏但仍挂载的 `ChatPanel` 会在收起时继续占一份 agent 订阅。这是现状「展开才订阅」的轻微变化，但换来 `fillInput` 可靠和少一次 foliate 重开。若 hidden 节点仍触发昂贵渲染，再改为 collapse-unmount + pending queue；MVP 先 keep-mounted。
- 目录不钉住：要对照目录连续点多个章节需再次打开抽屉。符合 D1，不加 pin。
