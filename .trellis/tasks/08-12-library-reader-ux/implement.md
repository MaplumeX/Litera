# Implement: Library & Reader UX Overhaul (Parent)

## Execution Order

1. **先实现 `08-12-library-management`**（start → implement → check → archive）
2. **再实现 `08-12-reader-enhancement`**（start → implement → check → archive）
3. **父任务集成验收**：端到端流程验证

## Checklist

### Phase A: library-management 子任务
- [ ] A.1 `task.py start .trellis/tasks/08-12-library-management`
- [ ] A.2 按该子任务 implement.md 执行
- [ ] A.3 按该子任务 check.md/验收标准检查
- [ ] A.4 `task.py archive .trellis/tasks/08-12-library-management`

### Phase B: reader-enhancement 子任务
- [ ] B.1 `task.py start .trellis/tasks/08-12-reader-enhancement`
- [ ] B.2 按该子任务 implement.md 执行
- [ ] B.3 按该子任务 check.md/验收标准检查
- [ ] B.4 `task.py archive .trellis/tasks/08-12-reader-enhancement`

### Phase C: 父任务集成验收
- [ ] C.1 端到端：启动 → 书库 → 导入 → 点击书 → 阅读（目录跳转/字体调节/主题切换）→ 返回书库 → 重进同一书（位置/设置恢复）
- [ ] C.2 AI 对话面板全程不受影响
- [ ] C.3 `npm run build` + `cargo build` 通过

## Validation Commands
```bash
cd /home/maplume/projects/Litera && npm run build
cd /home/maplume/projects/Litera/src-tauri && cargo build
```

## Rollback Points
- library-management 的 App.tsx 路由改动是破坏性变更（移除"打开即读"），若需回滚需恢复旧 App.tsx
- bookId 生成方式变更（路径变为 app data 副本）导致旧会话历史失效——已知可接受（早期开发）