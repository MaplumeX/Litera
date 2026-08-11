# Tauri + React Scaffolding

## Goal

搭建项目基础骨架：Tauri 2 + React + Vite + TypeScript + Tailwind + shadcn/ui，为后续子任务提供可运行的开发环境。

## Parent Reference

父任务：`08-11-agent-epub-reader`。本子任务对应 `implement.md` Child 1。

## Requirements

- 用 `create-tauri-app` 初始化 Tauri 2 + React + TypeScript + Vite 项目
- 初始化 Tailwind CSS + shadcn/ui
- 安装 `react-resizable-panels`（分栏布局底层）
- 安装 `react-markdown` + `remark-gfm`（agent 回答 Markdown 渲染）
- 添加 `tauri-plugin-dialog` 依赖（文件选择器）
- 配置 CSP：阻止 epub 内脚本（foliate.js 安全要求），允许 `blob:` src
- 建立目录结构：`src/`（React）、`src-tauri/`（Rust）、`sidecar/`（pi agent，空目录占位）

## Acceptance Criteria

- [ ] `npm run tauri dev` 启动空窗口，无报错
- [ ] Tailwind CSS 生效（一个 utility class 测试元素样式正确）
- [ ] shadcn/ui 初始化完成（至少一个组件如 Button 可引入渲染）
- [ ] `react-resizable-panels` 已安装
- [ ] `react-markdown` + `remark-gfm` 已安装
- [ ] `tauri-plugin-dialog` 依赖已添加
- [ ] CSP 配置就绪（`tauri.conf.json` 中）
- [ ] `sidecar/` 目录存在（空占位）

## Out of Scope

- foliate.js 集成（Child 2）
- pi sidecar 实现（Child 3）
- 任何业务功能