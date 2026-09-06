# Implement: Chat quick model switcher

## Checklist

1. [ ] `src/agent/runtime/model-resolution.ts`：导出 `listBuiltinModelIds(provider)`；`model-resolution.test.ts` 补测试
2. [ ] 新建 `src/components/chat/ModelSwitcher.tsx`（Props/行为见 design.md）
3. [ ] `ModelSwitcher.test.tsx`：内置 provider 列表、自定义 provider 列表、当前项打勾、未配置引导、streaming 禁用、选中回调
4. [ ] `ChatInput.tsx`：新增 `leadingControls?: React.ReactNode` 插槽（工具行左侧）；补/更新测试
5. [ ] `ChatPanel.tsx`：组合 ModelSwitcher → `leadingControls`，接 `switchProvider` + `setShowConfig(true)`；streaming 状态传入
6. [ ] i18n：`en.ts` / `zh-CN.ts` 新增 `chat.modelLabel` / `chat.modelNotConfigured` / `chat.switchModelFailed`
7. [ ] 全量 `npx vitest run`（或项目现行测试命令）确认无回归
8. [ ] 手动冒烟（实现 agent 完成后由 check 验证项覆盖）：切换 → 下一条消息用新模型 → 时间线出现 model_change

## Validation commands

```bash
npx vitest run src/agent/runtime/model-resolution.test.ts src/components/chat
npx tsc --noEmit   # 项目现行类型检查
```

## Review gates

- Step 1-3 完成后：ModelSwitcher 单测绿
- Step 7：全量测试绿
- Phase 2.2 由 trellis-check 做最后一轮全量检查

## Rollback points

- 每步为独立可 revert 的粒度；整体回滚 revert 单 commit
