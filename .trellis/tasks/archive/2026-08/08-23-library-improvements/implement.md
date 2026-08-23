# Implement: Library management UX

## Checklist

1. **Rust `update_book_metadata`**
   - 新 store 方法 + Tauri 命令；`cover_bytes: None` 保持封面；`Some` 压缩后原子写 `cover.jpg`。
   - 不改 `bookId` / EPUB / 进度 / 会话 / hash。空书名、空封面字节、过大封面、未知 id 走现有 `AppError`。
   - 注册到 `lib.rs`。
   - Rust 测试：只改书名保留封面和进度；换封面失败回滚；空书名拒绝。

2. **前端纯函数 + 浏览偏好**
   - `src/lib/library-shelf.ts`：五种排序、继续阅读前 4 本、搜索过滤。
   - `src/lib/library-shelf-prefs.ts`：`litera.librarySort` / `litera.libraryView`，非法值回退。不要碰 `preferences.json`。
   - 单测覆盖排序边界（空作者、无进度、无 `lastOpenedAt`）和非法 localStorage。

3. **菜单与详情**
   - `npx shadcn@latest add dropdown-menu context-menu`（若 CLI 失败，按现有 dialog 风格手抄，不要手写无障碍残缺的绝对定位菜单）。
   - `BookActionsMenu`：打开 / 详情 / 删除。
   - `BookDetailsDialog`：书名、作者、选图、只读进度和导入时间；保存调 `update_book_metadata`。
   - `BookCard` 加 ⋮ + 右键；保留 hover 删除。选择模式隐藏菜单。

4. **LibraryView 浏览**
   - 顶栏搜索旁：排序 `Select`、网格/列表切换。
   - 继续阅读横排：最多 4 本；空/搜索中不渲染；点击打开；可右键菜单。
   - 列表行：缩略图、书名、作者、进度、最近打开（窄屏可藏最后一列）、⋮。
   - 网格保持现有卡片。两种视图接同一套打开/菜单/选择模式。
   - 新文案进 `zh-CN.ts` / `en.ts`，`i18n.test.ts` 会卡 key 对称。

5. **回归**
   - 扩展 `LibraryView.test.tsx` / `BookCard` 测试：排序、视图切换、详情保存、继续阅读显隐、选择模式无菜单。
   - 不改导入去重、删除会话、阅读恢复测试的既有约定。

## Validation

```bash
cd src-tauri && cargo test
npm test
npm run build
```

手动（实现后、声明完成前）：

- 改书名/作者：卡片、列表、搜索、打开后顶栏都是新值；重开应用仍在。
- 换封面后卡片更新；详情里不选图保存，封面不变；书名清空不能保存。
- 五种排序肉眼可辨；按进度时没读过的在最后；继续阅读那一排顺序不跟主列表变。
- 切到列表再关应用，重开仍是列表 + 上次排序。
- 打开过 ≥1 本书时顶部最多 4 本；搜索时该区域消失。
- ⋮ 与右键能打开/详情/删除；点封面仍打开书。选择模式下没有菜单。
- 导入、覆盖确认、拖放、批量删除、阅读位置、AI 对话仍可用。

## Risky files

- `src-tauri/src/library.rs` — 新写路径，不要改导入事务。
- `src/components/LibraryView.tsx` — 同屏叠横排/排序/列表，容易回归选择模式和拖放。
- `src/components/BookCard.tsx` — 菜单与 hover 删除叠层。

回滚点：先落地 Rust 命令（清单 1）可单独编译；前端浏览（清单 4）不要和命令契约缠在一次无法还原的改动里。

## Before `task.py start`

- [x] `prd.md` 已收敛，无阻塞 Open Questions
- [x] `design.md` / `implement.md` 已写
- [x] `implement.jsonl` / `check.jsonl` 有真实 spec 条目
- [x] 用户批准本规划摘要后才能 `task.py start`
