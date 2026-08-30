# Implement: agent tool call & thinking UI 重设计

## Checklist

1. [x] 读取 `.trellis/spec/frontend` 规范
2. [x] 新增 i18n key（`src/locales/en.ts`、`src/locales/zh-CN.ts`）
3. [x] 重写 `ToolCallCard.tsx`：三态视觉、结果限高滚动、截断标注、复制按钮
4. [x] 重写 `AssistantMessage.tsx` 中的 `ThinkingBlock`：弱化视觉、shimmer、限高
5. [x] 补充/更新测试（新增 `ToolCallCard.test.tsx`）
6. [x] `npm test` 全量通过（627 passed）
7. [x] `npm run build` 通过

## Validation Commands

```bash
npm test
npm run build
```

## Review Gates

- 视觉验收：dark mode 下检查两类块
- 现有行为不回退：流式自动展开/收起、block 顺序渲染

## Rollback

改动集中在 3-4 个前端文件，直接 `git checkout` 回滚即可。
