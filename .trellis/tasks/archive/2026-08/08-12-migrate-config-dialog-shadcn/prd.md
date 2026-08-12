# Migrate AgentConfigDialog to shadcn/ui components

## Goal

把 `AgentConfigDialog` 里的原生 HTML 元素(`<select>`/`<input>`/`<label>`/手写遮罩 div)替换为 shadcn/ui 组件(Dialog / Select / Input / Label),与项目已采用的 shadcn Button 风格统一。

## Background

- 项目 `components.json` 已配置 shadcn(new-york 风格),`node_modules/radix-ui` 全套已装。
- `src/components/ui/` 目前只有 `button.tsx` 一个组件,其余 shadcn 组件未生成。
- `AgentConfigDialog` 是项目里唯一的弹窗,用 `<div className="fixed inset-0 ...">` 手写遮罩 + 原生表单元素,与 shadcn Button 风格不一致。
- `ChatPanel` 的"会话列表"是 absolute 浮层(非弹窗),不在本次范围。

## Requirements

### R1 安装 shadcn 组件

- 通过 `npx shadcn@latest add` 生成 `dialog`、`select`、`input`、`label` 到 `src/components/ui/`。
- 不修改既有 `button.tsx`。

### R2 替换 AgentConfigDialog

- 外层手写遮罩 → `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription`(保留点击外部关闭、ESC 关闭、标题/关闭按钮)。
- Provider `<select>` → shadcn `Select`(`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`)。保留:
  - 内置供应商选项
  - 自定义供应商分组(可用 `SelectGroup`/`SelectLabel` 替代原 disabled option 分隔符)
  - "＋ 添加自定义供应商…" 项(`ADD_CUSTOM_VALUE`)
  - `disabled={saving}` 行为
- 所有 `<input>` → shadcn `Input`(type/password/placeholder/value/onChange/disabled 保持)。
- 所有 `<label>` → shadcn `Label`(`htmlFor` 关联或保持现有样式)。
- `Button` 已用 shadcn,保持不变。

### R3 行为不变

- 所有交互逻辑(选中即切换、编辑表单、保存校验、删除、添加后切换)保持不变。
- 视觉风格向 shadcn 靠拢,但布局结构(竖向表单、按钮行)大体保持。

## Acceptance Criteria

- [ ] `src/components/ui/` 新增 `dialog.tsx`、`select.tsx`、`input.tsx`、`label.tsx`。
- [ ] `AgentConfigDialog` 内不再有原生 `<select>`/`<input>`/`<label>`/手写遮罩 div。
- [ ] Provider 下拉的分组、添加项、disabled 状态在 shadcn Select 下正常工作。
- [ ] 弹窗关闭(点击外部、ESC、关闭按钮、保存后自动关)行为正常。
- [ ] `npm run build` 通过,无 TS 错误。

## Scope

- 仅前端,仅 `AgentConfigDialog.tsx` + 新增 ui 组件文件。
- 不改后端、sidecar、其他组件。