# Implement: Reader Enhancement

## Ordered Checklist

### 1. ReaderView 扩展接口
- [ ] 1.1 扩展 `ReaderViewHandle`：新增 `goToFraction(frac)`、`goToTocItem(href)`、`setStyles(css)`、`getToc()`
- [ ] 1.2 实现 `goToFraction`：调用 `view.goToFraction(frac)`
- [ ] 1.3 实现 `goToTocItem`：调用 `view.goTo(href)`
- [ ] 1.4 实现 `setStyles`：调用 `view.renderer.setStyles(css)`（确认 renderer 可访问）
- [ ] 1.5 实现 `getToc`：打开后返回 `view.book.toc`（`[{ label, href, subitems }]`）
- [ ] 1.6 打开完成后回调 `onBookReady(toc, settings, lastFraction)` 通知 App

### 2. TocSidebar 组件
- [ ] 2.1 创建 `src/components/TocSidebar.tsx`：接收 `toc: TocItem[]`，渲染嵌套章节树
- [ ] 2.2 点击章节 → 调 `readerRef.goToTocItem(href)`
- [ ] 2.3 可折叠（宽度动画到 0），由 header 按钮控制

### 3. FontControl + ThemeControl 组件
- [ ] 3.1 创建 `src/components/ReaderControls.tsx`：合并字体 + 主题控制（字体大小档位 S/M/L/XL + 字体族选择 + 主题三按钮 light/dark/sepia）
- [ ] 3.2 字体/主题状态变化 → 合并生成 CSS → `readerRef.setStyles(css)`
- [ ] 3.3 CSS 模板：`html, body { font-family: <f>; font-size: <s>px !important; <theme colors> }`
- [ ] 3.4 三主题 CSS 定义（light 默认无额外颜色 / dark 黑底白字 / sepia 米黄底深棕字）

### 4. 位置恢复 + 设置持久化
- [ ] 4.1 App.tsx 保存 `currentBookRecord`（含 lastFraction + settings）
- [ ] 4.2 ReaderView `onBookReady` 后：用 settings 初始化 ReaderControls 状态 + setStyles；用 lastFraction 调 goToFraction
- [ ] 4.3 relocate 事件 → 防抖 500ms → `invoke('update_reading_state', { bookId, lastFraction })`
- [ ] 4.4 字体/主题变化 → 防抖 500ms → `invoke('update_reading_state', { bookId, settings })`

### 5. 返回书库
- [ ] 5.1 Header 新增"返回书库"按钮 → 调 `onBackToLibrary()` 回调
- [ ] 5.2 App.tsx 处理 `onBackToLibrary`：切 `view` 到 `'library'`，清理 fileData（保留 sidecar book 状态或按需重置）

### 6. 布局整合
- [ ] 6.1 reader 视图布局：Header（返回书库 + 书名 + 控制按钮组）→ 主体（TocSidebar | ReaderView+ChatPanel 分栏）→ Footer 翻页栏
- [ ] 6.2 TocSidebar 折叠时阅读区扩展（foliate.js 自动重新分页）
- [ ] 6.3 ReaderControls 可折叠/弹出（避免常驻占用空间），MVP 用 header 按钮触发的下拉面板

### 7. 验证
- [ ] 7.1 `npm run build` 编译通过
- [ ] 7.2 手动测试：目录侧边栏显示章节 + 点击跳转
- [ ] 7.3 手动测试：字体大小/字体族调节即时生效
- [ ] 7.4 手动测试：主题切换即时生效（light/dark/sepia）
- [ ] 7.5 手动测试：重开书恢复字体/主题/位置
- [ ] 7.6 手动测试：返回书库 → 再进同一书 → 位置/设置仍恢复
- [ ] 7.7 手动测试：AI 对话面板（选段问答、多会话、流式输出）正常

## Validation Commands
```bash
cd /home/maplume/projects/Litera && npm run build
```

## Risky Files / Rollback Points
- `src/components/ReaderView.tsx` — 扩展接口，保留现有 prev/next + relocate + selection 逻辑
- `src/App.tsx` — reader 视图布局重构，保留 ChatPanel 集成
- `src/foliate-js/view.js` — 不修改（仅调用 API），但 `view.renderer.setStyles` 依赖非官方公开字段

## Dependencies
- 依赖 `08-12-library-management` 的 `update_reading_state` 命令 + BookRecord 数据结构
- 依赖 App.tsx 的 `view` 路由状态（library-management 任务建立）

## Follow-up Before task.py start
- 确认 `view.renderer` 在 foliate-view 实例上的可访问性（已从源码确认是普通字段，非 #private）
- 确认 fixed-layout（foliate-fxl）的 setStyles 行为（可能不支持，MVP 仅保证 reflowable）