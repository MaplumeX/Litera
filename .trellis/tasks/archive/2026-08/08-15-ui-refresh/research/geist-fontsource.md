# Geist via Fontsource (Vite + Tauri)

Date: 2026-08-15

## Choice

Use `@fontsource-variable/geist`, not the Next.js-only `geist` package.

- Install: `npm install @fontsource-variable/geist`
- Import: `import "@fontsource-variable/geist/wght.css";` (weights 100-900)
- Family name to verify from the installed CSS (expected: `Geist Variable`)

## Why not other options

- `geist` (Vercel): `geist/font/sans` is Next.js `next/font`. This app is Vite + Tauri.
- Google Fonts `<link>`: blocked by CSP `font-src 'self' blob: data:`.
- System UI only: cheaper, but undercuts the Linear-like chrome we already chose.

## CJK

Geist has Latin / Greek / Cyrillic. Litera chrome is zh-CN / en. Stack must fall back:

```css
font-family: "Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
```

Do not apply this stack to foliate iframe styles (`generateStylesCss`). Reader body stays on user `fontFamily`.

## CSP

Existing `font-src 'self' blob: data:` is enough if Vite emits the woff2 under the app origin. Do not add `https://fonts.gstatic.com`.

## Sources

- https://www.npmjs.com/package/@fontsource-variable/geist
- https://fontsource.org/fonts/geist/install
- `src-tauri/tauri.conf.json` CSP `font-src`
