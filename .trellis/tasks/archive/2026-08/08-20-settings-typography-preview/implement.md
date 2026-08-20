# Implementation Plan: Settings dialog typography preview

## Ordered Checklist

1. **`src/lib/reader-styles.ts`** — 新增 `generatePreviewCss(state: ReaderStyleState): string`
   - 复用排版属性(`cssFontFamily` / font-size / line-height / letter-spacing / max-width / margin-inline / padding-inline / text-align / p 段距 / p 首行缩进)。
   - 选择器 scoped 到 `.litera-typography-preview` 与 `.litera-typography-preview p`。
   - 不含 `THEME_CSS`、不含 `html, body` 选择器、不注入全局背景色。
   - 验证:`src/lib/reader-styles.test.ts` 新增用例断言预览 CSS 含排版属性、不含 `background`、不含 `color:` 全局规则。

2. **`src/locales/zh-CN.ts` + `src/locales/en.ts`** — 新增 i18n 键
   - `settings.preview` → "预览" / "Preview"
   - `settings.preview.paragraph1` / `settings.preview.paragraph2` → 各语言两段示例文本(足够长以体现行高/段距/首行缩进)。
   - 验证:`src/lib/i18n.test.ts` 键对等测试自动覆盖新键。

3. **`src/components/settings/TypographyPreview.tsx`** — 新增预览组件
   - `TypographyPreview({ styleState }: { styleState: ReaderStyleState })`
   - `useT()` 取示例文本与标签;`useId()` 生成 scope(用于 `<style>` 唯一性,若用固定类名则可省)。
   - 渲染:`<style dangerouslySetInnerHTML={{ __html: generatePreviewCss(styleState) }} />` + 容器 `div.litera-typography-preview`(圆角/边框/背景)+ 标签 + 两段 `<p>`。
   - 无内部状态、无副作用。

4. **`src/components/settings/SettingsDialog.tsx`** — 接入预览
   - 在 `section === "typography"` 分支,`SLIDER_ROWS` 渲染之前插入 `<TypographyPreview styleState={styleState} />`。
   - 不改 props 接口、不改控件顺序。
   - 确认对话框尺寸 `w-[768px] h-[40rem]` 不变(预览在可滚动右侧区内)。

5. **`src/components/settings/SettingsDialog.test.tsx`** — 新增/调整测试
   - 新增:预览区在 typography 区域渲染(查询示例文本或预览标签)。
   - 新增:调整 fontSize slider 后预览 DOM `font-size` 变化(读 `.litera-typography-preview` 的 `<style>` 文本或 computed style)。
   - 新增:切换到 appearance 区域后预览不渲染。
   - 新增:zh-CN / en 下示例文本语言切换。
   - 检查现有查询是否因预览示例文本引入歧义(如重复数字/标签),按需调整。

6. **`src/lib/reader-styles.test.ts`** — `generatePreviewCss` 单元测试(若步骤 1 已含则合并)。

## Validation Commands

```bash
# 类型检查 + 构建
npm run build

# 测试
npm test -- --run src/lib/reader-styles.test.ts src/components/settings/SettingsDialog.test.tsx src/lib/i18n.test.ts

# 全量测试
npm test -- --run
```

## Review Gates

- 步骤 1 后:确认 `generatePreviewCss` 不含主题分支(读测试断言)。
- 步骤 4 后:确认对话框布局未撑破(读 `SettingsDialog.test.tsx` 尺寸测试)。
- 步骤 5 后:确认现有测试语义未变(无行为回归,仅查询调整)。

## Risky Files / Rollback Points

- `src/lib/reader-styles.ts` — 新增函数,不改现有 `generateStylesCss`,低风险。
- `src/components/settings/SettingsDialog.tsx` — 仅在 typography 分支插入一行渲染,低风险。
- `src/locales/*.ts` — 新增键,需保持两文件 key 对等(i18n.test.ts 守护)。
- 回滚点:每步独立可回退;最坏情况删除新增文件 + i18n 键 + 移除渲染行。