# 主题与设置入口统一化 — 执行计划

## Checklist

### 1. Rust 偏好存储

- [ ] 新增 `src-tauri/src/preferences.rs`：`PreferencesStore` 读写 `preferences.json`（含 `theme` 字段），原子写复用 `library.rs` 的 `atomic_write` + `sync_parent_directory`。
- [ ] `src-tauri/src/lib.rs`：setup 中初始化 `PreferencesStore` 并 `app.manage`，注册 `get_preferences` / `save_preferences` commands。
- [ ] `PreferencesStore` 含 schema_version=1，解析校验。

### 2. 前端偏好 hook

- [ ] 新增 `src/lib/preferences.ts`：`usePreferences` hook，`get_preferences` 加载 + `save_preferences` 防抖保存。
- [ ] 返回 `{ theme, setTheme }`。

### 3. 主题状态提升

- [ ] `src/App.tsx`：引入 `usePreferences`，`globalTheme` 驱动根容器 class（`light`→无、`dark`→`dark`、`sepia`→`sepia`）。
- [ ] `styleState.theme` 改从 `globalTheme` 派生；`handleStyleChange` 中 theme 变更走 `setGlobalTheme` 而非仅 `setStyleState`。
- [ ] `normalizeSettings` 调用点调整：`styleState` 初始化时 theme 取 `globalTheme`（需等 preferences 加载，或先默认 light 再同步）。

### 4. sepia CSS 变量

- [ ] `src/index.css`：新增 `.sepia { ... }` 块，定义 sepia 外壳配色（参考 foliate sepia：背景 `#f4edd8`、文字 `#5b4636`、border/input 等配套变量）。

### 5. 统一设置对话框

- [ ] 新增 `src/components/SettingsDialog.tsx`：两个 section：
  - 阅读偏好（字号/字体/主题）—— 复用 `ReaderControls` 逻辑或直接渲染控件。
  - AI 配置 —— "打开 AI 配置"按钮，点击打开 `AgentConfigDialog`。
- [ ] 书库页设置入口：`LibraryView` 顶栏添加 `Settings` 图标按钮，点击 `setShowSettings(true)` 渲染 `SettingsDialog`。
- [ ] 阅读器页设置入口：顶栏 `Type` 按钮改为打开 `SettingsDialog`（替代 `ReaderControls` 弹出面板）；`ChatPanel` 齿轮按钮改为打开 `SettingsDialog`。

### 6. 阅读偏好按书保存调整

- [ ] `handleStyleChange`：fontSize/fontFamily 仍走 `persistSettings`（按书）；theme 走 `setGlobalTheme`（全局）。
- [ ] `ReadingSettings.theme` 字段保留但不再写入（`persistSettings` 不再传 theme，或传但 Rust 侧忽略）。

### 7. 验证

- [ ] `npm test` 通过。
- [ ] `npm run build` 通过。
- [ ] `cargo test` 通过。
- [ ] 手动验证：书库页切换主题 → 外壳变色；阅读器切换 → 外壳 + foliate 同步；重启保留主题；书库页/阅读器页设置入口都可用。

## Validation Commands

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

## Review Gates

- 主题切换必须同时影响外壳和 foliate 渲染区。
- `preferences.json` 原子写 + 损坏恢复（参考 library.rs 模式）。
- 书库页设置入口在无书状态下可用（至少主题切换 + AI 配置）。
- `normalizeSettings` 不再从 per-book `settings.theme` 取值，避免与全局主题冲突。

## Rollback Points

- 若 `preferences.rs` 集成出问题，可回退到 theme 仍按书保存（但外壳不跟随）。
- 若 `SettingsDialog` 内嵌复杂度超预期，可退化为：书库页只加主题切换 + AI 配置入口，阅读器页保持原 `ReaderControls`。