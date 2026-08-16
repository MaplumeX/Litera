# App chrome font and size settings

## Goal

用户可以在外观里单独设置软件界面的字体和字号。改动立刻作用在书库、顶栏、聊天、设置等 chrome 上。阅读器正文排版不受影响。

## User value

现在只能改书页字体。界面写死 Geist，字号跟着默认 rem。界面看不清或想换字体时没有入口。

## Background

- 设置四栏：排版 / 外观 / AI / 关于。字体控件只在「排版」，经 `generateStylesCss` 注入阅读器（`src/lib/reader-styles.ts`）。外观现有主题、语言、默认模式（`SettingsDialog.tsx:529-566`）。
- Chrome 字体写死：`--font-sans: "Geist Variable", 中文系统回退…`（`src/index.css:78`），`body` 用 `font-sans`。Spec 禁止把 Geist / `--font-sans` 写进阅读器 CSS。
- `preferences.json` 的 `fontSize` / `fontFamily` 是**书页默认值**（16 / serif）。复用会改掉所有未覆盖的书。
- `PreferencesDataRaw` 使用 `deny_unknown_fields`。新键会让旧版本把文件当成损坏并重置主题/排版。同类前端偏好（语言、默认模式）放在 `localStorage`。
- Chrome 文本和几何几乎都是 rem（`text-sm`、`h-12`）。改 `html` 根字号会缩放文字和间距；只改 `body` 字号几乎动不到已写 `text-*` 的控件。阅读器在 iframe / closed shadow 里，父页根字号进不去书页。

## Decisions

- **D1** 字号是整界面缩放：改 `html` 根字号。文字、顶栏、按钮、间距一起变。阅读器不受影响。
- **D2** 字体列表复用阅读器的系统字体选择器；第一项是 Geist（当前默认），然后是衬线 / 无衬线 / 等宽，再然后是 `list_system_fonts`。
- **D3** 字号控件用与排版相同的滑条。范围 12–20px、步进 1、默认 16（浏览器 rem 默认）。比书页的 12–32 更窄，因为这是 UI 缩放，20 已经是 125%。
- **D4** 控件放在设置 → 外观，主题下面。标签与排版区分：界面字体 / 界面字号。改完立刻生效。
- **D5** 存 `localStorage`（`litera.uiFontSize` / `litera.uiFontFamily`），不写 `preferences.json`，不改 Rust。
- **D6** 不改中文默认字体。界面仍是 Geist + 苹方 / 雅黑 / Noto Sans SC。书页默认仍是 `serif`。不打包思源黑体。系统里装了思源时，可在界面字体列表里选。

## Requirements

### R1 外观里可改界面字体和字号

- 外观在主题下方提供「界面字体」和「界面字号」。
- 字体选择器：Geist 为首项且为默认；其后为现有三个 generic，再后为系统字体。可搜索。已保存但不在列表中的字体保持选中并标「不可用」，不改写存储值。
- 字号是 12–20 的滑条，显示当前像素值。默认 16。
- 修改立刻作用到界面，无需关设置。

### R2 只影响 chrome

- 作用面：书库、阅读/Agent 顶栏与抽屉、聊天、设置、进度条等应用 DOM。
- 不改变当前书的 `ReadingSettings`，不改变 `preferences.json` 里的书页默认字体/字号。
- `generateStylesCss` 的输出不因界面字体设置而含 Geist 或用户选的界面字体。

### R3 持久化与回退

- 刷新 / 重启后仍是上次的界面字体和字号。
- 缺省、非法、非数字、越界：回退到 Geist + 16，不抛错。
- 不往 `preferences.json` 写新键。

### R4 默认观感

- 未设置过时，外观与现在一致：Geist Variable + 中文回退，根字号 16px。

## Acceptance Criteria

- [ ] AC1. 设置 → 外观，主题下方有「界面字体」和「界面字号」。字体默认 Geist；字号滑条默认 16，范围 12–20。（R1, D2, D3, D4）
- [ ] AC2. 改字体后，书库/顶栏/聊天/设置立刻换字体；改字号后这些面的文字和间距一起缩放。（R1, D1）
- [ ] AC3. 打开一本书，书页字体/字号仍只跟排版走。界面设成非 Geist、非 16 之后，书页 CSS 不变，也不把界面字体写进 `generateStylesCss`。（R2）
- [ ] AC4. 改完关应用再开，界面字体和字号仍在。`preferences.json` 无新键。非法 localStorage 回退 Geist + 16。（R3, D5, R4）
- [ ] AC5. 选择器测到：Geist 在 generic 之前；系统字体可搜；缺失字体标不可用且不改写。`npm test` 与 `npm run build` 通过。

## Out of scope

- 改阅读器正文排版，或把界面字体注入 `generateStylesCss`。
- 把界面字体存进 `preferences.json` 或加 Tauri command。
- 行高、字重、聊天单独字体、按窗口/模式分套。
- 只放大文字、不缩放几何（已否决）。
- 精选短名单（已否决）。
- 系统级缩放快捷键（Ctrl+=）。
- 改中文默认字体、打包思源黑体 / Noto Sans SC、或改书页默认 `serif`（已否决，D6）。
