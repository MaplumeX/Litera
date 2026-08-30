# Fix agent event stream ordering in chat UI

## Goal

The agent runtime's underlying event stream is correctly interleaved (thinking → text → tool call → thinking → tool call → …), but the chat UI flattens it into "all thinking → all tool calls → final text" because `AgentMessage` models an assistant turn as three parallel fields instead of an ordered block list. Users cannot see the real reasoning/action order. Fix the projection layer so the chat renders blocks in true chronological order, both during streaming and when replaying a persisted session.

## Background / Evidence

- Event source is standard: `embedded-runtime.ts` `onPiEvent` forwards pi-agent-core events (`thinking_start/delta/end`, `text_delta`, `tool_execution_start/end`) in true arrival order. No information is lost at the event layer.
- The flattening happens in the UI projection layer:
  - `src/types/agent.ts` — `AgentMessage { role, content: string, thinking?: string, toolCalls?: AgentToolCall[] }`: three parallel fields, no ordering.
  - `src/lib/agent-reducer.ts` — `thinking_delta` appends to `message.thinking`, `text_delta` appends to `message.content`, `tool_start` appends to `message.toolCalls[]`; `updateLastAssistant` folds every assistant message of one prompt into a single bubble.
  - `src/components/chat/AssistantMessage.tsx` — renders in fixed order: ThinkingBlock, then all ToolCallCards, then Markdown content.
- Second defect: `pi-session.ts` `visibleMessages()` (lines ~199–230) extracts only `text` and `toolCall` blocks when rebuilding messages for `session_switched` / `session_rewound`; persisted `thinking` blocks are dropped, so thinking disappears after reload even though it is stored in the session file.
- Tool results are re-attached by `toolCallId` lookup (reducer `tool_end`, and `visibleMessages` `toolOwners` map) — correct but also order-agnostic.
- Consumers of the UI `AgentMessage` type: `AssistantMessage.tsx`, `MessageBubble.tsx`, `use-agent-bridge.ts` (pending edit ref), `agent-reducer.ts`, `embedded-runtime.ts` (`uiUserMessage`), `pi-session.ts` (`visibleMessages` → `UiAgentMessage[]`).
- `compaction.ts` imports `AgentMessage` from `@earendil-works/pi-agent-core` — unrelated type, not affected.
- Persistence layer already stores assistant messages with ordered content block arrays (`thinking`, `text`, `toolCall` blocks), so no storage migration is needed; this is purely a projection-layer fix.

## Research Summary (industry survey)

- **Vercel AI SDK** (de-facto standard frontend model): `UIMessage.parts: Part[]` — an ordered typed array (`text`, `reasoning`, `tool-input-streaming`, `tool-output-available`, …). Multi-step agent-loop parts are merged into a single assistant message and rendered in order. Part order is treated as a rendering contract (vercel/ai#7857 treats wrong order as a bug).
- **uipotion "AI Response Rendering" pattern**: model the message as a state machine over a structured content tree, never a growing string; ordered blocks (text / code / tool-call / reasoning); tool-call cards have pending→running→success/error lifecycle; reasoning defaults collapsed, auto-expands while streaming, collapses after (litera's current ThinkingBlock behavior matches).
- **Claude/ChatGPT consumer UIs**: single assistant bubble per user turn containing an ordered timeline (collapsed reasoning on top, tool activity cards in order, final answer below). Multi-bubble per-tool-call "transcript" rendering is confined to developer-facing TUIs (pi, Claude Code terminal).
- **claudette issue #562** describes Litera's exact defect (tool calls aggregated after all text/thinking, causal link lost) and fixed it by inline interleaved rendering.

Decision informed by research: single bubble with interleaved ordered blocks (option A), not per-turn transcript bubbles. Matches consumer-agent UX convention and minimizes blast radius (ChatPanel edit indexes, TOC anchors, scrolling untouched).

## Requirements

1. Replace the flat three-field assistant message model with an ordered content-block model (e.g. `blocks: Array<{ type: "thinking" | "text" | "toolCall", … }>`) while keeping user messages unchanged (`content`, `selection`, `chapterHref`).
2. Reducer maintains blocks in event order:
   - `thinking_delta` appends to the last block if it is the same thinking run, otherwise opens a new thinking block.
   - `text_delta` appends to the last text block, otherwise opens a new text block.
   - `tool_start` appends a toolCall block; `tool_end` fills its result by `toolCallId`.
   - The existing prompt/session matching guards (`matchesPrompt`) are preserved unchanged.
3. `AssistantMessage` renders blocks in array order: thinking blocks (collapsible, current auto-expand-while-streaming behavior), tool cards, and text blocks interleaved exactly as they occurred.
4. `visibleMessages()` reconstructs the same ordered block list from persisted session entries, including `thinking` blocks (fixes the thinking-disappears-after-reload defect). Tool results still attach by `toolCallId`.
5. Session replay after `session_switched` / `session_rewound` produces visually the same block sequence as the original live stream.
6. Message editing (`editIndex`) continues to target visible user messages; the user-message indexing used by `use-agent-bridge.ts` and ChatPanel must keep working.

## Acceptance Criteria

- AC1: During a streaming turn with interleaved events (thinking → text → tool → thinking → tool → text), the UI shows blocks in that exact chronological order, not grouped by type.
- AC2: After switching away from and back to a session (or reloading), the assistant messages render the same ordered block sequence including thinking blocks.
- AC3: Tool result payloads still display in the expandable tool card (params + result, error state) with results matched by `toolCallId`.
- AC4: Editing an earlier user message and resubmitting still works (rewind + new branch behavior unchanged).
- AC5: Unit tests cover: reducer block ordering for interleaved deltas, `visibleMessages()` block extraction including thinking + tool result attachment, and AssistantMessage render order.
- AC6: Existing test suites (`agent-reducer.test.ts`, `pi-session.test.ts`, `AssistantMessage.test.tsx`, `ChatPanel.test.tsx`, `embedded-runtime.test.ts`) pass after migration.

## Decisions

- UX granularity (user-confirmed): single assistant bubble per prompt, interleaved ordered blocks (option A). Informed by industry research above.
- History thinking blocks render after reload (user-confirmed yes; requirement R4).

## Out of Scope

- Persistence format changes (session file schema stays as-is).
- pi-agent-core / event layer changes (`embedded-runtime.ts` event mapping stays as-is).
- Compaction logic, title generation, retry/abort flows (behavior unchanged).
- Any change to user message presentation.

