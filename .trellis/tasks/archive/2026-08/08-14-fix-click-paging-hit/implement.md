# Fix click page-turn hit testing — implement

## Checklist

1. 在 `src/lib/reader-paging.ts` 增加 `pageLocalX(clientX, pageWidth)`（正向取模；`pageWidth <= 0` 返回 `0`）。
2. 在 `src/lib/reader-paging.test.ts` 按 `design.md` 补用例，并断言折算后的 `hitFromClientX` 在「第 3 页偏右」为 `"right"`、偏左为 `"left"`。
3. 改 `src/components/ReaderView.tsx` 里 iframe `bindPointerPaging` 的 `getX` / `getWidth`：宽度用 `doc.documentElement.clientWidth`，X 先走 `pageLocalX`。宿主绑定不要动。
4. 不要改键盘、滚轮、`shouldIgnorePagingTarget`、单击 slop / 选区 / 链接判定。

## Validation

```bash
npm test
npm run build
```

手工（若本机有书）：打开一个多页章节，分别在首页、中间页、末页点正文左 / 中 / 右三分之一。

## Risks

- 只改 `getWidth`、不改 `getX` 会让后半本书整页翻下一页。实现时对照 `design.md` 的「不要」列表。
- `documentElement.clientWidth` 依赖 foliate 把 `html` 设成单页宽。不要改子模块；若宽度为 0，分区回落到 middle。

## Rollback

Revert the single frontend commit.
