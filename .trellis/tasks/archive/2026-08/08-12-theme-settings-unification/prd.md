# 主题与设置入口统一化

## Goal

让阅读器的 light/dark/sepia 主题同时作用于 App 外壳（书库页、工具栏、聊天面板），并在书库页与阅读器页提供统一的设置入口。

## Requirements

### 17 主题全局化

- 切换主题时，App 外壳（书库页、顶栏、聊天面板、TocSidebar）跟随变化，而非仅注入 foliate 渲染区。
- 三档主题（light / dark / sepia）在外壳上有对应的 CSS 变量配色。
- 主题偏好持久化：无书打开时也能切换并生效；重启应用后保留上次主题。

### 18 设置入口统一

- 书库页提供设置入口，可打开阅读偏好设置（字号/字体/主题）与 AI 配置。
- 阅读器页的设置入口保持可用，且同时包含阅读偏好与 AI 配置。
- 阅读偏好与 AI 配置可通过统一入口访问，无需分别寻找。

## Constraints

- 当前 `styleState`（fontSize/fontFamily/theme）存于 `App.tsx` 并仅在阅读器有入口；`theme` 只注入 foliate 不影响外壳。
- 当前 `index.css` 只有 `:root`（light）和 `.dark`（dark）两套 CSS 变量，无 sepia 外壳配色。
- 当前 AI 配置入口（`AgentConfigDialog`）只在 `ChatPanel` 内，书库页无法打开。
- 需引入"全局主题状态"：在 App 顶层管理 theme，切换时给 `<html>` 或根容器加 class，触发 CSS 变量切换。
- 字号/字体仍按书保存（`ReadingSettings`），但主题改为全局偏好（不按书存储），因为外壳主题不应随书变化。
- 主题持久化复用现有存储：可存到 `library.json` 顶层或独立 `preferences.json`。倾向独立文件 `preferences.json` 以保持职责清晰。

## Acceptance Criteria

- [ ] 切换主题时，书库页、顶栏、聊天面板、TocSidebar 的配色全部跟随变化。
- [ ] 三档主题（light/dark/sepia）在外壳上都有正确的配色。
- [ ] 书库页有设置入口，可打开阅读偏好与 AI 配置。
- [ ] 阅读器页设置入口同时包含阅读偏好与 AI 配置。
- [ ] 主题偏好持久化：重启应用后保留上次主题。
- [ ] 无书打开时（书库页）也能切换主题并生效。
- [ ] `npm test` + `npm run build` 通过。