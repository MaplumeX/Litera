# Design: Reader Enhancement

## Architecture

在现有阅读界面基础上增强，不新增进程或数据层，仅扩展 React 组件树与 foliate.js 交互：

```
┌──────────────────────────────────────────────────────────┐
│  React (WebView)                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ App.tsx (reader view)                               │ │
│  │  ┌─ Header ─────────────────────────────────────┐   │ │
│  │  │ [返回书库] [书名] | [目录☰] [字体Aa] [主题☀]  │   │ │
│  │  ├──────────┬───────────┬───────────────────────┤   │ │
│  │  │ TOC      │ Reader    │ ChatPanel (现有)       │   │ │
│  │  │ Sidebar  │ <foliate- │                       │   │ │
│  │  │ (可折叠)  │ view>     │                       │   │ │
│  │  │          │           │                       │   │ │
│  │  ├──────────┴───────────┴───────────────────────┤   │ │
│  │  │ [上一页]  章节 · 42%  [下一页]                │   │ │
│  │  └─────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Boundaries

### 1. TOC 侧边栏（`TocSidebar` 组件，新增）

- 数据来源：`foliate-view` 打开后 `view.book.toc` → `[{ label, href, subitems? }]`
- 渲染为可折叠树（嵌套 `subitems` 缩进）
- 点击章节 → `view.goTo(href)`
- 可折叠（header 按钮切换显示/隐藏）
- 布局：阅读区左侧的窄列，可折叠为 0 宽度

### 2. 字体调节（`FontControl` 组件，新增）

- 字体大小：预设档位（如 S/M/L/XL 对应 14/16/18/20px）或滑块，MVP 用档位按钮
- 字体族：预设选项（衬线 Serif / 无衬线 Sans-serif / 等宽 Mono）
- 应用方式：`view.renderer.setStyles(css)` — foliate.js Paginator 内置，自动在每次 section 加载后重新应用
- CSS 内容：`html, body { font-family: <family>; font-size: <size>px !important; }`

### 3. 主题切换（`ThemeControl` 组件，新增）

- 三主题：light（白底黑字）、dark（黑底白字）、sepia（米黄底 #f4edd8 深棕字 #5b4636）
- 应用方式：同字体，通过 `setStyles` 注入颜色 CSS
- CSS 内容（dark 示例）：
  ```css
  html, body { background: #1a1a1a !important; color: #e0e0e0 !important; }
  a { color: #6db4ff !important; }
  img { filter: brightness(0.8) !important; }
  ```

**统一 setStyles 调用**：字体 + 主题合并为一段 CSS，每次调节都重新调用 `view.renderer.setStyles(combinedCss)`。

### 4. 位置恢复

- 打开书时：从 BookRecord 读取 `lastFraction` → `view.goToFraction(frac)`（在 `view.open()` + `view.init()` 之后）
- relocate 事件：`onRelocate(index, fraction, label)` → 防抖（500ms）调 `invoke('update_reading_state', { bookId, lastFraction: fraction })`

### 5. 阅读设置持久化

- 字体/主题变化时 → 防抖（500ms）调 `invoke('update_reading_state', { bookId, settings: { fontSize, fontFamily, theme } })`
- 打开书时从 BookRecord 读取 `settings` → 初始化 FontControl/ThemeControl 状态 → 首次 setStyles

### 6. 返回书库

- Header 新增"返回书库"按钮 → 调 `onBackToLibrary()` 回调 → App.tsx 切 `view` 状态到 `'library'`

## Data Flow

### 打开书 + 恢复设置/位置
1. App.tsx 从书库收到 bookId → `invoke('open_book', { bookId })` → bytes + BookRecord
2. ReaderView 用 bytes 打开 foliate-view
3. foliate-view `open` 完成 → 读取 `view.book.toc` → 传给 TocSidebar
4. 从 BookRecord.settings 初始化字体/主题状态 → `view.renderer.setStyles(css)`
5. 从 BookRecord.lastFraction → `view.goToFraction(frac)`

### 字体/主题调节
1. 用户调字体/主题 → 组件状态更新
2. 合并字体+主题为一段 CSS → `view.renderer.setStyles(combinedCss)`
3. 防抖 500ms → `invoke('update_reading_state', { bookId, settings })`

### 翻页/位置更新
1. foliate-view relocate 事件 → `onRelocate(index, fraction, label)`
2. 更新底部进度显示（即时）
3. 防抖 500ms → `invoke('update_reading_state', { bookId, lastFraction: fraction })`

## Contracts

### ReaderView 扩展接口

```typescript
export interface ReaderViewHandle {
  prev: () => void;
  next: () => void;
  goToFraction: (frac: number) => void;      // 新增
  goToTocItem: (href: string) => void;       // 新增
  setStyles: (css: string) => void;          // 新增
  getToc: () => TocItem[];                   // 新增
}

interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}
```

### 依赖 library-management 的命令

```typescript
// 更新阅读位置/设置（library-management 提供）
invoke<void>('update_reading_state', {
  bookId: string,
  lastFraction?: number,
  settings?: { fontSize?: number; fontFamily?: string; theme?: string }
})
```

## Key Trade-offs

1. **setStyles vs 手动注入 iframe**：选 `setStyles`（foliate.js Paginator 内置，自动处理 section 切换时重新应用）。代价：依赖 foliate.js renderer 的 public 可访问性（`view.renderer` 是普通字段非私有，已确认可访问）。
2. **字体档位 vs 滑块**：选档位（简单，UI 占用小）；v2 可加滑块。
3. **位置恢复用 fraction vs CFI**：选 fraction（`goToFraction` API 直接可用，精度够）；CFI 更精确但需额外解析，v2 升级路径。
4. **防抖持久化 vs 每次事件写**：选防抖（避免频繁 IO，500ms 足够实时）。

## Compatibility / Rollback

- ChatPanel 完全不改动。
- 现有 `prev/next` + 进度显示保留。
- `ReaderView` 新增方法不破坏现有接口。
- foliate-view 的 `relocate` 事件监听保留，新增防抖持久化副作用。

## Risks / Deferred

- `view.renderer` 非官方公开 API（虽可访问）→ foliate.js 升级时可能变化 → submodule 锁定 commit 规避
- 固定布局 epub（foliate-fxl）的 `setStyles` 行为可能不同 → MVP 聚焦 reflowable epub，fxl 仅保证不崩溃
- 主题注入可能与 epub 内嵌样式冲突 → 用 `!important` 覆盖；极端 epub 可能有残留样式，v2 评估