# 主题与设置入口统一化 — 技术设计

## 现状分析

### 主题状态
- `styleState` 存于 `App.tsx`，含 `{ fontSize, fontFamily, theme }`。
- `theme` 只通过 `generateStylesCss` 注入 foliate 渲染区（`view.renderer.setStyles`），不影响 App 外壳。
- `index.css` 只有 `:root`（light）和 `.dark`（dark）两套 CSS 变量；无 sepia。
- `styleState` 的 `fontSize`/`fontFamily` 按书保存（`update_reading_state`），`theme` 也跟着按书保存。

### 设置入口
- 阅读偏好（字号/字体/主题）：只在阅读器顶栏 `ReaderControls` 弹出面板。
- AI 配置（`AgentConfigDialog`）：只在 `ChatPanel` 内的齿轮按钮。
- 书库页无任何设置入口。

## 设计方案

### 1. 主题状态架构重构

**核心决策**：`theme` 从"按书保存"改为"全局偏好"，因为外壳主题不应随书变化。`fontSize`/`fontFamily` 仍按书保存。

**新增全局偏好**：
- 新增 `src/lib/preferences.ts`：管理全局偏好（当前仅 `theme`），读写 `preferences.json`（通过 Tauri command）。
- 新增 Rust 侧 `preferences.rs`：读写 `app_data_dir/preferences.json`。
- 新增 Tauri commands：`get_preferences` / `save_preferences`。

**theme 状态提升**：
- `App.tsx` 新增 `globalTheme` state（`"light" | "dark" | "sepia"`），初始化时从 `get_preferences` 加载。
- `styleState` 保留 `fontSize`/`fontFamily`（按书），`theme` 改为从 `globalTheme` 派生。
- 切换主题时：`setGlobalTheme` + `save_preferences`（防抖）+ 同步更新 `styleState.theme`（驱动 foliate 注入）。

**外壳主题应用**：
- `App.tsx` 根 `<div>` 或 `<html>` 根据 `globalTheme` 加 class：`light` → 无 class（默认 `:root`），`dark` → `dark`，`sepia` → `sepia`。
- `index.css` 新增 `.sepia { ... }` 块，定义 sepia 外壳配色。
- foliate 注入仍由 `generateStylesCss` 处理（保持渲染区独立配色，已有实现）。

### 2. 设置入口统一

**统一设置对话框**：新增 `src/components/SettingsDialog.tsx`，整合：
- 阅读偏好面板（字号/字体/主题）—— 复用 `ReaderControls` 的逻辑，但改为对话框形式。
- AI 配置入口 —— 内嵌或链接到 `AgentConfigDialog`。

**决策**：`SettingsDialog` 作为统一入口，内部用 tab 或分区展示"阅读偏好"和"AI 配置"两块。`AgentConfigDialog` 保持独立组件，`SettingsDialog` 内可渲染它或提供跳转。

**入口布局**：
- **书库页**：`LibraryView` 顶栏添加设置按钮（`Settings` 图标），点击打开 `SettingsDialog`。
- **阅读器页**：顶栏现有的 `Type` 按钮（`ReaderControls`）改为打开 `SettingsDialog`；`ChatPanel` 的齿轮按钮改为打开 `SettingsDialog`（或保留直接打开 AI 配置，但统一入口更一致）。

**简化决策**：为减少改动面，`SettingsDialog` 内部分两个 section（阅读偏好 + AI 配置），`AgentConfigDialog` 的内容直接内嵌（而非嵌套 Dialog），避免 Dialog 套 Dialog。

### 3. 存储设计

**`preferences.json`**（新增）：
```json
{ "theme": "light" }
```
- 路径：`app_data_dir/preferences.json`
- Rust 侧 `preferences.rs`：原子写（复用 `atomic_write`），schema_version=1。
- 前端通过 `get_preferences` / `save_preferences` 读写。

**`library.json` 的 `ReadingSettings.theme`**：
- 保留字段但不再作为主题来源（向后兼容旧数据）；`theme` 改由 `preferences.json` 驱动。
- `normalizeSettings` 不再从 `settings.theme` 初始化 `styleState.theme`，改从 `globalTheme` 取。

## 涉及文件

### 新增
- `src/lib/preferences.ts` — 前端偏好读写 hook
- `src-tauri/src/preferences.rs` — Rust 偏好存储
- `src/components/SettingsDialog.tsx` — 统一设置对话框

### 修改
- `src/App.tsx` — 主题状态提升、设置入口接入、`globalTheme` 管理
- `src/index.css` — 新增 `.sepia` CSS 变量块
- `src/lib/reader-styles.ts` — `normalizeSettings` 调整（theme 不再从 per-book settings 取）
- `src/components/LibraryView.tsx` — 顶栏添加设置按钮
- `src/components/ChatPanel.tsx` — 齿轮按钮改为打开 `SettingsDialog`（或保留，见下）
- `src/components/ReaderControls.tsx` — 可能改为对话框内组件或保留独立
- `src-tauri/src/lib.rs` — 注册 `preferences` 模块 + commands
- `src/types/library.ts` — `ReadingSettings.theme` 标注为 deprecated 或保留

## 数据流

```
[启动] → get_preferences → globalTheme 初始化 → <html> class → CSS 变量 → 外壳配色
                                                  → styleState.theme → foliate 注入

[切换主题] → setGlobalTheme → <html> class 更新 → 外壳变色
                            → styleState.theme 更新 → foliate 注入
                            → save_preferences（防抖）→ preferences.json

[打开设置] → SettingsDialog → 阅读偏好区（字号/字体/主题）+ AI 配置区
```

## 风险与权衡

- **主题从按书改为全局**：已有 `ReadingSettings.theme` 数据不再使用，但保留字段不破坏旧数据。`normalizeSettings` 行为变化需测试。
- **`SettingsDialog` 内嵌 AI 配置**：`AgentConfigDialog` 当前是独立 Dialog，内嵌需抽取其内容为非 Dialog 组件。权衡：保留 `AgentConfigDialog` 作为独立入口，`SettingsDialog` 提供按钮跳转打开它，避免嵌套 Dialog。**采用此方案**：`SettingsDialog` 内"AI 配置"区只放一个"打开 AI 配置"按钮，点击打开 `AgentConfigDialog`。
- **sepia 外壳配色**：需设计 sepia 变量，参考 foliate 的 sepia（`#f4edd8` 背景、`#5b4636` 文字）。
- **无书时字号/字体设置**：书库页打开设置时，字号/字体无当前书可应用。选择：书库页设置只显示主题切换，字号/字体提示"打开书籍后可调"。或允许设全局默认字号/字体。**采用前者**：简化，书库页设置只含主题 + AI 配置入口。