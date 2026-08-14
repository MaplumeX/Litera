# Fix click page-turn hit testing — design

## Architecture & Boundaries

只改前端点击坐标换算。不改 Rust、sidecar、书库、聊天、键盘/滚轮、foliate-js 子模块。

| 文件 | 职责 |
|---|---|
| `src/lib/reader-paging.ts` | 新增：把 iframe `clientX` 折进当前可见页 |
| `src/lib/reader-paging.test.ts` | 覆盖取模、负余数、`pageWidth <= 0` |
| `src/components/ReaderView.tsx` | iframe 的 `getX` / `getWidth` 改用该函数 + `documentElement.clientWidth` |

`hitFromClientX`、`bindPointerPaging` 的单击判定、`pageLeft` / `pageRight` 调用保持不变。

## Data flow

```
iframe pointerup
  → pageWidth = doc.documentElement.clientWidth   // one spread
  → x = pageLocalX(clientX, pageWidth)
  → hitFromClientX(x, pageWidth)
  → goLeft() / goRight() / ignore
```

宿主路径不变：

```
host pointerup
  → x = clientX - hostRect.left
  → hitFromClientX(x, host.clientWidth)
```

## Click mapping

`pageLocalX(clientX, pageWidth)`：

- `pageWidth <= 0` → 返回 `0`（`hitFromClientX` 会得到 `"middle"`）
- 否则 `positiveMod(clientX, pageWidth)`，即 `((clientX % pageWidth) + pageWidth) % pageWidth`

iframe 绑定：

```
getX:    (ev) => pageLocalX(ev.clientX, pageWidthOf(doc))
getWidth: () => pageWidthOf(doc)

pageWidthOf(doc) = doc.documentElement?.clientWidth ?? 0
```

不要：

- 用 `doc.defaultView.innerWidth`（整章宽）
- 只换 width、不换 `clientX`（页 2+ 整页变 right）
- 把 iframe 点击映射到 `foliate-view` 全宽（宽屏正文落在 middle）
- 从外部查 `#container`（paginator 是 closed shadow root）
- 盖左右遮罩

RTL：取模对负 `clientX` 要折回正区间。动作仍走 `goLeft` / `goRight`。竖排不专项处理。

## Tests

不挂 foliate，只测纯函数：

- `pageLocalX(0, 800) === 0`
- `pageLocalX(799, 800) === 799`
- `pageLocalX(800, 800) === 0`（下一页左缘）
- `pageLocalX(1600 + 50, 800) === 50`（第 3 页偏左）
- `pageLocalX(1600 + 700, 800) === 700`（第 3 页偏右 → 与 `hitFromClientX` 得到 `"right"`）
- `pageLocalX(-50, 800) === 750`
- `pageLocalX(10, 0) === 0`

现有 `hitFromClientX` 用例保留。

## Compatibility

- 不改 `relocate`、持久化、`init` / `goToFraction` 顺序。
- 不改键盘 / 滚轮。
- 固定版式 EPUB 不专项处理。

## Rollback

单次前端 commit 可整体 revert。无数据迁移。
