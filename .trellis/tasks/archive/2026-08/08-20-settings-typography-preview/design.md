# Design: Settings dialog typography preview

## Architecture & Boundaries

新增一个 `TypographyPreview` 组件,放在 `src/components/settings/TypographyPreview.tsx`,作为 `SettingsDialog` typography 区域内的纯展示子组件。它接收当前 `styleState`,派生预览 CSS,渲染固定示例文本。

```
SettingsDialog (typography section)
  └── TypographyPreview        ← 新增
        ├── <style> (generated CSS scoped to a unique class)
        └── preview container (fixed example text, 2+ paragraphs)
  └── [现有 SliderRow / FontFamilyPicker / SegmentedControl 控件]
```

边界:
- `TypographyPreview` 是纯函数式组件,只依赖 `styleState` 和 `useT()`,无内部状态、无副作用、不调用 Tauri。
- 不修改 `SettingsDialog` props 接口;`TypographyPreview` 复用父组件已有的 `styleState`。
- 不修改 `App` 数据流;预览只读 `styleState`,不回写。

## Data Flow

```
App.styleState (current book override OR global default)
  → SettingsDialog props.styleState
    → TypographyPreview props.styleState
      → generatePreviewCss(styleState)  ← reader-styles.ts 新增
        → <style> 注入 scoped CSS
        → 示例文本 DOM 应用样式
```

用户拖动滑块 → `onTypographyChange` → `App` 更新 `styleState`(经 debounced 持久化) → `SettingsDialog` 收到新 `styleState` → `TypographyPreview` 重渲染。预览实时反映,无需等待外部回写(R3.2 满足:React 重渲染是同步的)。

## Contracts

### `reader-styles.ts` 新增

```ts
/** 排版预览 CSS,剥离主题分支,不注入 html/body 全局背景色。
 *  选择器 scoped 到 `.litera-typography-preview` 容器。 */
export function generatePreviewCss(state: ReaderStyleState): string
```

实现策略:复用 `generateStylesCss` 的排版部分,但:
- 选择器从 `html, body` / `p` 改为 `.litera-typography-preview` / `.litera-typography-preview p`。
- 省略 `THEME_CSS` 分支(不注入夜间背景)。
- 保留 `font-family`(经 `cssFontFamily`)、`font-size`、`line-height`、`letter-spacing`、`max-width`、`margin-inline: auto`、`padding-inline`、`text-align`,以及 `p { margin-block-end; text-indent }`。

> 取舍:不复用 `generateStylesCss` 直接套用,因为它的 `html, body` 选择器与主题分支会在对话框内产生全局污染(R5.2 / AC7)。新增独立函数 `generatePreviewCss` 职责清晰,且 `reader-styles.ts` 测试可独立验证预览 CSS 不含主题背景。

### `TypographyPreview.tsx`

```ts
interface TypographyPreviewProps {
  styleState: ReaderStyleState;
}
```

- 用 `useId()` 生成唯一 scope id,避免多个实例(虽然当前只有一个)样式冲突。
- 通过 `<style>` 注入 `generatePreviewCss`,选择器用固定类名 `.litera-typography-preview`。
- 示例文本:2 段,经 i18n(`useT()`),zh-CN / en 各一段本地化内容。
- 容器有视觉边界:圆角 + 浅色背景 + 边框(R3.4)。

### i18n 新增键

`src/locales/zh-CN.ts` / `src/locales/en.ts`:
```
"settings.preview": "预览" / "Preview"
"settings.preview.paragraph1": "<中文示例段 1>"
"settings.preview.paragraph2": "<中文示例段 2>"
```
en 对应英文示例段。示例文本需足够长以体现行高/字间距/段距/首行缩进差异(约 2-3 行)。

## Compatibility & Migration

- 无持久化迁移:不新增 localStorage 键、不修改 preferences.json、不修改 Rust。
- 无 props 接口变更:`SettingsDialog` 现有 props 不变。
- 现有 `generateStylesCss` 签名与行为不变(foliate iframe 路径不受影响)。
- 现有测试:`SettingsDialog.test.tsx` 的部分查询(如 `getByText("16px")`)仍有效,因为控件区不变;新增预览区可能引入重复文本,需检查查询歧义并按需用 `getAllByText` 或 within scope。预览示例文本不应与现有控件标签冲突。

## Trade-offs

- **独立 `generatePreviewCss` vs 复用 `generateStylesCss`**:选独立函数。理由:`generateStylesCss` 的 `html, body` 选择器和主题分支是 foliate iframe 专用的;在对话框内用 scoped 类名更安全,且可测试。代价是少量 CSS 文本重复(可接受,排版属性列表很短)。
- **`<style>` 注入 vs inline style**:选 `<style>`。理由:`generatePreviewCss` 产出的 CSS 含 `p` 选择器(段距、首行缩进),inline style 无法作用于子 `<p>`。scoped 类名 + `<style>` 是最小可行方案。
- **不模拟主题**:预览只反映排版,不反映夜间/白天主题(R3.3 / AC7)。理由:`generateStylesCss` 的主题分支会向 `html, body` 注入全局背景色,在对话框内会污染整个对话框;且用户调排版时关注的是字体/间距,主题在外观区已切换。预览区用对话框自身背景 + 中性文字色。

## Rollback

- 预览组件是新增文件,回滚只需从 `SettingsDialog` 移除 `<TypographyPreview>` 渲染并删除文件、i18n 键、`generatePreviewCss`。无数据/持久化遗留。