# 执行计划:现代化阅读器 UI 重构

## 执行顺序

### Step 1: App.tsx 阅读器顶栏 + 底栏
- [ ] 导入 lucide 图标:`ChevronLeft, List, Type, MessageSquare, MessageSquareOff`
- [ ] 顶栏:左侧返回按钮 → `ghost icon-sm` + `ChevronLeft` + `aria-label`
- [ ] 顶栏:右侧操作组容器 `<div className="flex items-center gap-1">`
  - [ ] 进度条(内联组件 `ReaderProgressBar`):细条 + 章节文字 + 百分比
  - [ ] 目录按钮:`List` 图标,`tocVisible ? "secondary" : "ghost"`
  - [ ] Aa 按钮:`Type` 图标,`controlsOpen ? "secondary" : "ghost"`
  - [ ] 对话按钮:`MessageSquare`/`MessageSquareOff`,`chatCollapsed ? "outline" : "ghost"`
- [ ] 删除整个 `<footer>` 块(上一页/下一页)
- [ ] 新增键盘翻页 `useEffect`(ArrowLeft/Right,判断非 input/textarea,仅 reader 视图)

### Step 2: ChatPanel.tsx 头部
- [ ] 导入 `MessagesSquare, Settings, RefreshCw`
- [ ] `☰ 会话` → `MessagesSquare` icon-xs
- [ ] `⚙ 设置` → `Settings` icon-xs
- [ ] `重启助手` → `RefreshCw` icon-xs
- [ ] 状态文字弱化:emoji 移除,改 `text-[10px] text-muted-foreground`,与按钮分行或弱化排版

### Step 3: LibraryView.tsx 导入按钮
- [ ] 导入 `Plus`
- [ ] 导入按钮加 `Plus` 图标,文字保留

### Step 4: 验证
- [ ] `npm run build` 通过
- [ ] `npm run typecheck`(若有)通过
- [ ] grep 确认 lucide-react 引用数 ≥ 5
- [ ] 人工检查:顶栏无文字按钮、底栏已删、聊天头无字符按钮

## 验证命令

```bash
npm run build
grep -rn "from \"lucide-react\"" src/ | wc -l  # 应 ≥ 5 文件或引用
```

## 回滚点

- 每步独立 commit,便于 `git revert`
- 无数据迁移,无需特殊回滚脚本

## Review Gates

- Step 1 完成后:目视顶栏布局,确认分组正确、图标显示
- Step 2 完成后:确认聊天头部按钮可点击、状态文字不重叠
- Step 4:build 通过 + 功能回归(打开书、目录、字体、聊天、翻页)

## 风险文件

- `src/App.tsx` —— 改动最大,顶栏重构 + 底栏删除 + 键盘事件,易引入回归
- `src/components/ChatPanel.tsx` —— 头部逻辑状态多(restarting/unavailable/bookReady 三态),改按钮时勿破坏条件分支