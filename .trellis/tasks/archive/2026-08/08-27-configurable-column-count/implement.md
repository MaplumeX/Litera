# Implement: Configurable column count

## 执行顺序（每步可独立验证）

### Step 1 — 前端数据层
- [ ] `src/types/library.ts`: `ReadingSettings.columnCount?: number`
- [ ] `src/lib/reader-styles.ts`: TypographyKey / TYPOGRAPHY_KEYS / TYPOGRAPHY_RANGES / DEFAULT_COLUMN_COUNT / TypographyDefaults / DEFAULT_TYPOGRAPHY / normalizeSettings / materializeOverrides 补 columnCount
- [ ] `src/lib/preferences.ts`: PreferencesResponse + normalizePreferences + savePreferences invoke 参数
- [ ] 测试：`src/lib/reader-styles.test.ts`（normalize 缺省 2、clamp 0→1 / 4→3、per-book 覆盖优先、snapshot 含 columnCount）

### Step 2 — 阅读器应用
- [ ] `src/components/ReaderView.tsx`: handle 加 `setColumnCount`，clamp 1–3，`renderer.setAttribute("max-column-count", String(n))`；交叉类型补 setAttribute
- [ ] `src/App.tsx`: book ready + styleState effect 中调用 `setColumnCount(styleStateRef.current.columnCount)`
- [ ] 测试：`ReaderView.test.tsx` 覆盖 setAttribute 调用与 clamp

### Step 3 — 设置界面 + 文案
- [ ] `src/components/settings/SettingsDialog.tsx`: 排版区分栏数行（SegmentedControl 1/2/3 + restore）
- [ ] `src/locales/zh-CN.ts` / `en.ts`: `settings.columns`
- [ ] 测试：`SettingsDialog.test.tsx` 渲染 / 切换 / 恢复默认

### Step 4 — Rust 后端
- [ ] `src-tauri/src/preferences.rs`: PreferencesDataRaw / PreferencesData / PreferencesResponse / From / Default / PreferencesPatch / validate_patch / save_preferences 命令参数
- [ ] `src-tauri/src/library.rs`: ReadingSettings.column_count + is_empty + validate_settings
- [ ] 测试：preferences / library 现有测试模块补 columnCount 用例（缺省、越界拒绝）

### Step 5 — 全量验证
- [ ] `npm run build`（tsc + vite）或 `npx tsc --noEmit`
- [ ] `npx vitest run`
- [ ] `cargo test`（src-tauri）
- [ ] 手动 smoke：`npm run tauri dev`（可选，若环境允许）——切换 1/2/3 栏立即生效、位置不丢、恢复默认、per-book 与全局互不串扰

## 提交

- 单分支小步提交：Step 1-3 前端一个 commit，Step 4 后端一个 commit（或合为一个，视改动量定）。
- commit message 风格沿用近期历史（祈使句、无 scope 前缀，如 `Add configurable column count setting`）。

## 回滚点

- 每个 Step 独立可 revert；后端字段带 serde default，回滚前端不破坏旧数据。