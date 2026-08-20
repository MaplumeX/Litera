# Implement: 修复脚注弹窗高度、样式与定位

## 实现顺序

1. **`src/lib/reader-styles.ts`** — 新增 `footnotePopupCss()`（透明背景、`min-height: 0`、取消 `max-width` / 整页 padding / 首行缩进、紧凑内边距）。`generateStylesCss` 不动。
2. **`src/foliate-js.d.ts`** — `FoliateRenderer` 增加 `viewSize?: number`。
3. **`src/components/FootnotePopup.tsx`** — 抽出定位纯函数：水平居中、下方优先、上方翻转、视口夹取。`useLayoutEffect` 改用该函数。
4. **`src/components/ReaderView.tsx`** — `relocate` 用 `renderer.viewSize`（无效则回退 body 高度）；`setStyles(stylesCss + footnotePopupCss())`；内嵌 view `background: transparent`。
5. **测试** — `reader-styles.test.ts` 覆盖覆盖层；定位纯函数用例；现有 FootnotePopup 测试不回归。

## 检查清单

### Step 1: footnotePopupCss
- [ ] 函数无参数、返回 CSS 字符串，可单独测试。
- [ ] 覆盖 `html, body` 背景为 transparent、`min-height: 0`、`height: auto`、`max-width: none`、`margin-inline: 0`、padding 约 `0.75rem`。
- [ ] 覆盖 `p` 的 `text-indent: 0` 和更小的段间距。
- [ ] 规则带 `!important`，能压过 `generateStylesCss`。
- [ ] 不改 `generateStylesCss` 输出（现有测试仍过）。

### Step 2: 类型
- [ ] `FoliateRenderer.viewSize?: number`。
- [ ] `FoliateInnerView.renderer` 能读 `viewSize` 和 `setStyles`。

### Step 3: 定位
- [ ] 纯函数可单测，不依赖真实 layout。
- [ ] 锚点 x 是盒子水平中心；默认在锚点下方 `POPUP_GAP`。
- [ ] 下方不够且上方空间更大时翻到上方。
- [ ] 最后夹取，边距沿用 `VIEWPORT_MARGIN`。
- [ ] 宽度仍 `w-[26rem] max-w-[calc(100vw-1rem)]`。不做箭头、不加阴影。

### Step 4: ReaderView
- [ ] `relocate`：`const h = inner.renderer?.viewSize`；`h > 0` 才 `setFootnoteHeight`；与当前 state 相同则不 set。
- [ ] `setStyles` 追加 `footnotePopupCss()`；`stylesCss` 为空时只注入覆盖层。
- [ ] `inner.style.background = "transparent"`。
- [ ] 不改 `footnoteOpenRef` / seq 竞态 / 链接委托 / Esc / closeFootnote。

### Step 5: 测试与验证
- [ ] `footnotePopupCss()`：含 transparent、`min-height: 0`、`text-indent: 0`、padding；拼在 `generateStylesCss` 后面仍能覆盖 `text-indent` 和深色背景。
- [ ] 定位：居中；右边缘夹取；底部锚点上翻。
- [ ] 现有 `FootnotePopup.test.tsx`（loading / mount / backdrop / Esc）通过。
- [ ] `npm test`、`npm run build` 通过。

## 验证命令

```bash
npx vitest run src/lib/reader-styles.test.ts src/components/FootnotePopup.test.tsx
npm test
npm run build
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `src/components/ReaderView.tsx` | 挂载 effect 内脚注路径 | 只还原高度 / setStyles / background 三处 |
| `src/components/FootnotePopup.tsx` | 定位计算 | 还原 clamp effect |
| `src/lib/reader-styles.ts` | 新函数；勿改 `generateStylesCss` | 删除新函数 |
| `src/foliate-js.d.ts` | 只增 `viewSize` | 还原该字段 |

## 遵循规范

- 不修改 `src/foliate-js/**`。
- 不改主阅读器 `generateStylesCss` / `App.tsx` 的 `setStyles`。
- 新 CSS 工具放 `reader-styles.ts`，定位纯函数贴近 `FootnotePopup`。
- 类型只增不改：`viewSize` 加在 ambient `FoliateRenderer`。
- 实现后更新 `.trellis/spec/frontend/component-guidelines.md` 脚注约定（高度用 `viewSize`、追加 `footnotePopupCss`、居中+上翻、透明背景）。该 spec 更新在 Phase 3.3，不在本次实现提交前抢跑。

## Follow-up checks（task.py start 前）

- [x] prd.md / design.md / implement.md 已齐备。
- [x] implement.jsonl / check.jsonl 有真实条目。
- [ ] 规划摘要已向用户呈现并获得批准。
