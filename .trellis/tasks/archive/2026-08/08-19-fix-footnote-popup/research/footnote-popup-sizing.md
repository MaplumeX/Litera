# Research: 脚注弹窗高度、样式、背景

## viewSize

`src/foliate-js/paginator.js` 778 行：`viewSize` 返回 `#view.element` 在 `sideProp`（横排 scrolled 即 `height`）上的 `getBoundingClientRect()`。`expand()` 在 scrolled 模式把 iframe 高度设成 `documentElement` 高度。片段提取后，这就是脚注内容高度，而不是弹窗容器高度。

当前代码量 `body.getBoundingClientRect().height`。占位容器 160px 时，若书 CSS 有 `min-height: 100%`，量到的就是 160，短注不会收缩。

## 覆盖层必须压过 generateStylesCss

`generateStylesCss` 给 `html, body` 写了 `max-width`、`padding-inline`、`margin-inline: auto`，给 `p` 写了 `text-indent` 和段间距。深色主题还有 `html, body { background: #1a1a1a !important }`。内嵌 view 若原样注入，弹窗会像缩小的正文页，并带一层书页底色。

覆盖层跟在后面，用 `!important` 清掉这些卡片不需要的规则；字体 / 字号 / `color` 保留。

## 没有 no-background

readest 对内嵌 renderer 设 `no-background`。本仓库 paginator 没有该 attribute（`src/foliate-js` 搜不到）。不能打 submodule 补丁。`getBackground`（paginator.js:189）在 body 背景透明且无背景图时用 `documentElement` 的 background。html/body 都设 `transparent !important` 后，`#background` 应保持透明，外壳 `bg-popover` 透出来。

## 定位

现实现：`left = x`（x 是引用中心），`top = y + 8`，超出视口则 `top = max(8, innerHeight - 8 - height)`。底部引用会被推到靠近视口顶。

应水平居中于 x；下方不够且上方空间更大时翻到 `y - gap - height`；再夹取。
