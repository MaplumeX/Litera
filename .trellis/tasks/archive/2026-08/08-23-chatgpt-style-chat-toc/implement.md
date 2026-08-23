# Implementation plan

## Checklist

1. Extract hover-intent helper (150ms first activation, immediate after, leave resets) with unit tests. Do not import Paseo packages.
2. Replace `src/components/chat/UserMessageToc.tsx` with the workspace rail (same file or rename to `ChatOutlineRail.tsx` and fix imports). Keep `userMessagePreview()`.
3. Wire `ChatPanel`:
   - Mount rail only when `variant === "workspace"` and there are ≥2 user messages.
   - Overlay it on the message column left; reuse existing jump + active-index + bottom-follow suspension.
   - Remove header `List` button and `showMessageToc` overlay state from both variants.
4. i18n: remove unused close-copy if the overlay is gone; keep rail/tick labels in `zh-CN` and `en`.
5. Rewrite tests:
   - Preview truncation (unchanged).
   - Workspace: rail present at ≥2 user messages; hidden at 0/1; ticks exclude assistant text; hover/focus preview; jump + suspend follow; active tick tracks scroll; session/book change does not leak preview.
   - Docked: no「对话目录」button, no rail, no complementary overlay.
6. Run `npx vitest run src/components/chat/` (and any i18n catalog test if keys are asserted).

## Validation

```bash
npx vitest run src/components/chat/UserMessageToc.test.tsx src/components/chat/ChatPanel.test.tsx
npx vitest run src/components/chat/
```

If the file is renamed, point vitest at the new test path.

## Risky files

- `src/components/chat/ChatPanel.tsx` — jump/scroll/session effects. Do not regress stick-to-bottom or session rail.
- Existing `ChatPanel.test.tsx` overlay cases will fail until rewritten.

## Rollback

Revert the chat-outline files and restore the header `List` + overlay `UserMessageToc`. No data migration.
