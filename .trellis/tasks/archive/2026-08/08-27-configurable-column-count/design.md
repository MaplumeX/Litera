# Design: Configurable column count

## 数据模型与取值

- 新排版项 `columnCount: 1 | 2 | 3`（整数），默认 `DEFAULT_COLUMN_COUNT = 2`。
- foliate paginator 的 `max-column-count` 属性接收该值；实际栏数 = `min(maxColumnCount, ceil(size / maxInlineSize))`，竖屏容器回退 1 栏——均为 foliate 内建行为，应用层不做额外计算。
- 不引入字符串枚举或"auto"档位；恢复默认 = 移除覆盖并回到 2。

## 变更面（分层）

### 前端

1. `src/types/library.ts` — `ReadingSettings` 增加 `columnCount?: number`（camelCase 序列化已由 serde 侧处理，前端类型加可选字段）。
2. `src/lib/reader-styles.ts`
   - `TypographyKey` 联合类型与 `TYPOGRAPHY_KEYS` 数组加 `"columnCount"`。
   - `TYPOGRAPHY_RANGES` 加 `columnCount: { min: 1, max: 3, step: 1, unit: "" }`（使其能复用 clampSnap / normalizeContinuous；注意 `ContinuousKey` 因此包含 columnCount，属预期）。
   - `DEFAULT_COLUMN_COUNT = 2`；`TypographyDefaults` / `DEFAULT_TYPOGRAPHY` 加 `columnCount`。
   - `normalizeSettings`、`materializeOverrides`、`isTypographyOverridden`（`!= null` 判断已统一覆盖）补 `columnCount` 分支。
   - 不改 `generateStylesCss` / `generatePreviewCss`（分栏不是 CSS 注入，走 paginator 属性）。
3. `src/lib/preferences.ts`
   - `PreferencesResponse` 接口加 `columnCount?: number`。
   - `normalizePreferences` 传入 `columnCount`（normalizeSettings 内 clamp 到 1–3）。
   - `savePreferences` invoke 参数加 `columnCount: next.columnCount`。
4. `src/components/ReaderView.tsx`
   - `ReaderViewHandle` 新增 `setColumnCount: (count: number) => void`。
   - 实现里 clamp 到 1–3 后调用 `view.renderer.setAttribute("max-column-count", String(n))`（renderer 是 paginator 元素，observedAttributes 已含 `max-column-count`，设置后 foliate 自动 relayout）。
   - `FoliateAnnotator.renderer` 类型补 `setAttribute?`（HTMLElement 本身已有，仅需打通现有交叉类型；实际直接对 viewRef 的 renderer 调用即可）。
   - 打开书 / mount 后的初始应用：与 `setStyles` 相同的模式，由 App 在 book ready 与 styleState 变化时调用。
5. `src/App.tsx`
   - book ready 回调中：`readerRef.current?.setColumnCount(styleStateRef.current.columnCount)`。
   - styleState 变化的现有 effect 中同步调用 `setColumnCount`（与 `setStyles` 并列）。
6. `src/components/settings/SettingsDialog.tsx`
   - 排版区新增 `PresetRow`（inline SegmentedControl，选项 `1`/`2`/`3`），放在"对齐"行附近；restore 走 `onRestoreDefault("columnCount")`。
   - SegmentedControl 的 value 用字符串 `"1" | "2" | "3"`，onChange 转数字。
7. `src/locales/zh-CN.ts` / `en.ts` — 新增 `settings.columns`（"分栏数"/"Columns"）；选项直接显示数字 1/2/3，无需单独文案。

### 后端（Rust）

8. `src-tauri/src/preferences.rs`
   - `PreferencesDataRaw`（`#[serde(default)] column_count: Option<i64>`，camelCase → `columnCount`）、`PreferencesData`（`column_count: i64`）、`PreferencesResponse`、`From` 转换、`Default`（2）、`From<PreferencesDataRaw>`（clamp 1–3 或默认）、`PreferencesPatch`（Option 字段 + is_empty + save 分支）、`validate_patch`（1–3 整数校验）、`save_preferences` 命令参数。
   - 兼容性：`#[serde(default)]` 使旧文件缺字段时取默认 2；新文件多出的字段对旧版本前端无影响（旧前端不读）。
9. `src-tauri/src/library.rs`
   - `ReadingSettings` 加 `column_count: Option<i64>`（rename `columnCount`，skip_serializing_if none）；`is_empty` 补字段；`validate_settings` 加 1–3 校验。`deny_unknown_fields` 已存在，因此新旧前后端混用旧后端会拒收新字段——升级路径上旧版本后端只在本版本之前存在，可接受（与既有字段演进一致）。

## 兼容性 / 回滚

- 旧 preferences.json / reading-state 无 `columnCount` → serde default + 前端 normalize 回退 2，无迁移脚本。
- 回滚 = revert 提交；新增字段在旧代码下表现为默认值，无破坏性残留（后端 `deny_unknown_fields` 是唯一注意点：降级后再由新前端写出的 settings 会含 columnCount 被旧后端拒绝——与历史加字段做法一致，不额外处理）。

## 测试策略

- `reader-styles.test.ts`：normalize（缺省 2、clamp 越界、per-book 覆盖优先）、`bookSettingsSnapshot` 含 columnCount、`isTypographyOverridden`。
- `SettingsDialog.test.tsx`：排版区渲染分栏数行、三档切换回调、恢复默认。
- `ReaderView.test.tsx`：setColumnCount 调用 paginator `setAttribute("max-column-count", …)`，越界 clamp。
- Rust：`preferences.rs` / `library.rs` 现有测试模块补 columnCount 用例（反序列化缺省、patch 校验拒绝 0/4）。