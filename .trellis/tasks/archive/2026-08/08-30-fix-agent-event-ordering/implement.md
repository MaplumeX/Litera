# Implementation Plan

## Ordered Checklist

1. **Type model** (`src/types/agent.ts`)
   - Add `AssistantBlock` union (`thinking` | `text` | `toolCall`).
   - Extend `AgentMessage` with optional `blocks?: AssistantBlock[]` (assistant only).
   - Keep `AgentToolCall` unchanged.

2. **Reducer block folding** (`src/lib/agent-reducer.ts`)
   - Rewrite the `text_delta` / `thinking_delta` / `tool_start` / `tool_end` cases per design.md.
   - `updateLastAssistant` gains block-aware update logic; sync `content` (joined text blocks) on every mutation.
   - Guard behavior (`matchesPrompt`) unchanged.

3. **Replay projection** (`src/agent/sessions/pi-session.ts`)
   - `visibleMessages()`: build ordered `blocks` from persisted assistant content arrays, including `thinking` blocks; attach tool results via the existing `toolOwners` map (re-keyed to block locations).
   - Merge consecutive assistant entries into one UI message.

4. **Rendering** (`src/components/chat/AssistantMessage.tsx`)
   - Render `blocks` in array order (ThinkingBlock / ToolCallCard / Markdown).
   - Fallback: if `blocks` undefined and `content` non-empty, render `content` as a single text block.
   - Copy button and streaming cursor behavior preserved.

5. **Test migration + new coverage**
   - `agent-reducer.test.ts`: update flat-field assertions; add interleaved-order test (thinking → text → tool → thinking → tool → text produces exactly that block sequence; `tool_end` out-of-order completion).
   - `pi-session.test.ts`: replay produces blocks including thinking; tool result attached by id; consecutive assistant entries merged.
   - `AssistantMessage.test.tsx`: render order test (thinking block appears before an earlier tool card when blocks say so); existing collapse behavior tests keep passing.
   - `ChatPanel.test.tsx` / `embedded-runtime.test.ts`: adjust only where they construct or assert assistant message shape.

## Validation Commands

```bash
npx vitest run src/lib/agent-reducer.test.ts src/agent/sessions/pi-session.test.ts src/components/chat/AssistantMessage.test.tsx src/components/chat/ChatPanel.test.tsx src/agent/runtime/embedded-runtime.test.ts
npm run lint
npx tsc --noEmit
```

Full check before finish (sub-agent `trellis-check`): `npx vitest run` (whole suite) + lint + typecheck.

## Risky Files / Rollback Points

- `src/lib/agent-reducer.ts` — highest regression risk (streaming correctness); commit after reducer+replay tests pass? No: single atomic commit planned; the rollback point is the whole commit.
- `src/agent/sessions/pi-session.ts` — replay correctness; covered by pi-session tests.
- Rollback: revert the single commit; no persisted-format change.

## Review Gates

- Gate 1 (after steps 1–3): unit tests for reducer + replay green.
- Gate 2 (after steps 4–5): full test suite + lint + typecheck green; manual smoke not available in this environment — visual verification deferred to user.

## Pre-start Notes

- Spec files to load for sub-agents: `frontend/state-management.md`, `frontend/type-safety.md`, `frontend/component-guidelines.md`, `frontend/quality-guidelines.md`.
