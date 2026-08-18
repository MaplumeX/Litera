# PRD: Fix chat scroll jump on session enter

## 背景

进入/切换聊天会话时,消息列表会从顶部平滑滚动到底部,视觉上像"从最上滚到最底"。

## 根因

`src/components/chat/ChatPanel.tsx`:

1. `useEffect` 依赖 `state.sessionId`,切换会话时无条件调用 `scrollToBottom()`。
2. `scrollToBottom` 使用 `scrollIntoView({ behavior: "smooth" })`。
3. 切换会话时 reducer 一次性替换整个 `messages` 数组,渲染后容器 scrollTop 位于顶部附近,平滑动画从顶部一路滚到底部,历史越长越明显。

## 需求

- 切换/进入会话时,消息列表**瞬时**定位到底部,不播放从顶到底的平滑动画。
- 流式输出期间(消息增量更新)保持现有的平滑滚动体验。
- 用户手动上滚查看历史时,不被强制拉回底部(现有 `stickToBottom` 逻辑保持不变)。

## 验收标准

1. 切换会话或首次进入会话时,视口直接位于消息底部,无可见的从顶到底滚动动画。
2. 流式输出新内容时仍平滑跟随到底部。
3. 用户上滚后(`stickToBottom` 为 false),新消息到达不强制拉回底部。
4. 现有测试 `src/components/chat/ChatPanel.test.tsx` 全部通过。
