# Restore reader page turning — implement

## Checklist

### 1. Pure helpers

- [ ] 新增 `src/lib/reader-paging.ts`：`hitFromClientX`、`shouldIgnorePagingTarget`、`consumeWheelDelta`。
- [ ] 新增 `src/lib/reader-paging.test.ts`：三分区边界、输入/dialog 忽略、滚轮阈值与清零。

### 2. ReaderView input

- [ ] 在 mount 的 `foliate-view` 上听 `load`，给每个 `doc` 绑 pointer / key / wheel。
- [ ] 给宿主绑同样的 pointer / wheel（覆盖页边留白）。
- [ ] 给 `window` 绑 keydown 作为 iframe 未聚焦时的回退。
- [ ] 单击分区调用 `goLeft` / `goRight`；滚轮调用 `prev` / `next`。拖选、链接、dialog/输入不翻页。
- [ ] unmount 时卸掉 window / host 监听；`close()` 仍由现有 cleanup 负责。

### 3. App.tsx

- [ ] 删除 `src/App.tsx:211-232` 的键盘翻页 `useEffect`。不要留第二套监听。

### 4. Types

- [ ] 若调用 `goLeft` / `goRight`，在 `src/foliate-js.d.ts` 补声明。保持调用点 `as unknown as` 窄转，符合 type-safety spec。

### 5. Verify

- [ ] `npm test`
- [ ] `npm run build`
- [ ] 手动：打开书 → 点左/中/右 → 划词问 agent → 点正文后再按方向键 → 滚轮翻一页 → 聊天输入里按方向键不翻页 → 进度条更新。

## Validation Commands

```bash
npm test
npm run build
```

## Review Gates

- 不修改 `src/foliate-js/`。
- 不加回底栏翻页按钮。
- 不用左右 1/3 透明遮罩挡正文。
- 不把 `flow` 设成 `scrolled`。
- 不打乱 `open` → `init` → `goToFraction`。
- App 与 ReaderView 不能同时听 window 键盘。

## Rollback

Revert 该前端 commit。
