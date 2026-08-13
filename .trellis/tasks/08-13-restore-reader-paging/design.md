# Restore reader page turning — design

## Architecture & Boundaries

只改前端阅读器输入层。不改 Rust、sidecar、书库、聊天、foliate-js 子模块。

| 文件 | 职责 |
|---|---|
| `src/lib/reader-paging.ts` | 纯函数：点击分区、是否忽略按键、滚轮累加是否该翻页 |
| `src/lib/reader-paging.test.ts` | 覆盖分区、忽略条件、滚轮阈值 |
| `src/components/ReaderView.tsx` | 绑定宿主 + iframe 的 click / key / wheel，调用 `prev` / `next` / `goLeft` / `goRight` |
| `src/App.tsx` | 删除现有父窗口 `keydown` 翻页 effect，避免双触发 |
| `src/foliate-js.d.ts` | 如需，补 `goLeft` / `goRight` |

`ReaderView` 独占翻页输入。`prev` / `next` 的 imperative handle 保留，给目录以外的调用方，但 App 不再自己听键盘。

## Data flow

```
pointerup / keydown / wheel
  → reader-paging helpers decide prev | next | ignore
  → view.goLeft() / goRight() 或 prev() / next()
  → foliate relocate
  → 现有 onRelocate → 进度条 + persistFraction
```

无新 IPC、无新 React state。

## Input rules

### Click

不要在 iframe 上盖左右 1/3 遮罩。

在这些目标上听 `pointerdown` / `pointerup`：

1. 每个章节 iframe `doc`（foliate `load` 的 `detail.doc`）
2. `foliate-view` 宿主（paginator 左右留白）

判定为「单击翻页」当且仅当：

- 主键
- 位移小于约 5px
- 当前 selection 折叠（iframe 内用 `doc.getSelection()`，宿主用 `window.getSelection()`）
- 目标不是 `a[href]`

水平位置相对**该事件目标的 viewport 宽度**（iframe 用 `doc.defaultView.innerWidth`，宿主用 host `clientWidth`）：

- `x < width / 3` → `goLeft()`
- `x > width * 2 / 3` → `goRight()`
- 中间 → 忽略

`goLeft` / `goRight` 已处理 RTL。若运行时方法缺失，回退 `prev` / `next`。

### Keyboard

`ReaderView` 同时听：

- `window` `keydown`（焦点在顶栏等非 iframe 区域）
- 每个 iframe `doc` `keydown`（点过正文后）

`ArrowLeft` → `goLeft()`，`ArrowRight` → `goRight()`。`preventDefault`。

忽略当：

- `target` 是 `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable`
- `event.closest('[role="dialog"]')` 存在
- `event.defaultPrevented`

不处理空格、PageUp、PageDown。

### Wheel

听 iframe `doc` 和宿主，`{ passive: false }`，`preventDefault`。忽略 `ctrlKey`（捏合缩放）。

用纯函数累加 `deltaY`（若 `|deltaX|` 更大则用 `deltaX`）。超过阈值（约 80）翻一页并清零累加器；翻页后短冷却，避免一次甩动手势连翻。下/右 → `next()`，上/左 → `prev()`（阅读顺序，不随 RTL 镜像）。

## Binding lifecycle

现有 mount effect 在 `foliate-view` 上加 `relocate`。同一处加 `load`：

```
onLoad({ doc }) {
  bind doc: pointerdown, pointerup, keydown, wheel
}
```

章节切换会换 iframe，旧 `doc` 随 section unload 丢掉。在 `ReaderView` unmount 时 `close()` + `remove()` 即可；不要在 `load` 之间漏绑。宿主和 `window` 监听在 ReaderView 的 effect cleanup 里卸掉。

回调进 ref（与现有 `onRelocateRef` 相同），避免重绑导致反复 `open`。

## Tests

抽纯函数，不挂 foliate：

- `hitFromClientX(x, width)` → `"left" | "right" | "middle"`
- `shouldIgnorePagingTarget(el)` → boolean
- `consumeWheelDelta(state, delta)` → `{ turn: -1 | 1 | 0, state }`

## Compatibility

- 不改 `view.init` / `goToFraction` 顺序。
- 不改 `relocate` 契约。
- 固定版式 EPUB 不专项处理；若 `goLeft` 不存在则 no-op。

## Rollback

单次前端 commit 可整体 revert。无数据迁移。
