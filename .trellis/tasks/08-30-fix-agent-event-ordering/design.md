# Design: Ordered content blocks for assistant messages

## Architecture & Boundaries

This is a UI projection-layer change. Boundaries:

- **Unchanged**: `embedded-runtime.ts` event mapping (`onPiEvent`), persistence format (Pi v3 session entries), compaction, title generation, user message shape.
- **Changed**: `src/types/agent.ts` (UI message model), `src/lib/agent-reducer.ts` (delta folding), `src/agent/sessions/pi-session.ts` `visibleMessages()` (replay projection), `src/components/chat/AssistantMessage.tsx` (rendering), and the tests that assert the old flat fields.

## Data Model

New discriminated union in `src/types/agent.ts`:

```ts
export type AssistantBlock =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "toolCall"; toolCall: AgentToolCall }; // AgentToolCall keeps toolCallId/tool/params/result/done/isError

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;            // user: full text; assistant: concatenated text blocks (legacy convenience, keep in sync)
  selection?: string;         // user only
  chapterHref?: string;       // user only
  blocks?: AssistantBlock[];  // assistant only
}
```

Rationale for keeping `content` on assistant messages: `ChatPanel` computes `userMessagePreview` / TOC items and `use-agent-bridge` stores pending edit messages; keeping `content` as the joined text avoids touching those call sites. `AssistantMessage` must not read `content` for rendering — it renders from `blocks` (falling back to treating `content` as one text block when `blocks` is undefined, for safety on hand-built messages in tests).

Thinking-block identity: adjacent `thinking_delta`s append to the last block iff it is a thinking block. `thinking_start`/`thinking_end` carry `contentIndex`, but the reducer does not need to key blocks by it — a new run always follows either a tool/text block or message start, so "last block is thinking" is sufficient to detect continuation. (Multiple simultaneous thinking blocks never interleave at the event layer.)

## Data Flow

### Streaming (reducer)

`updateLastAssistant` semantics change to block-aware:

- `thinking_delta`: if last block is `thinking`, append delta to its `text`; else push new `{ type: "thinking", text: delta }`.
- `text_delta`: if last block is `text`, append; else push new `{ type: "text", text: delta }`.
- `tool_start`: push `{ type: "toolCall", toolCall: { toolCallId, tool, params, done: false } }`.
- `tool_end`: find block by `toolCall.toolCallId` anywhere in the last assistant message (concurrent calls finish out of order) and set `result`/`done`/`isError`.
- All existing `matchesPrompt` guards unchanged.
- Every block mutation also updates the message's `content` convenience field (join of text blocks) so consumers outside `AssistantMessage` see no behavior change.

### Replay (`visibleMessages()` in pi-session.ts)

For each assistant `message` entry, walk `message.content` (the persisted ordered block array) and build `blocks`:

- `thinking` block → `{ type: "thinking", text }`
- `text` block → `{ type: "text", text }`
- `toolCall` block → `{ type: "toolCall", toolCall: { toolCallId, tool, params, done: true } }`

Tool results arrive as separate `toolResult` messages; keep the existing `toolOwners` map (keyed by `toolCallId`) but store the block location, then attach `result`/`isError` when the `toolResult` entry is reached. This preserves both ordering and result attachment.

Consecutive persisted assistant entries (agent loop iterations) merge into one UI message: append their blocks to the current assistant message's `blocks` instead of pushing a new message. (Matches the current single-bubble folding; now order-preserving.)

### Rendering (`AssistantMessage.tsx`)

Replace the fixed three-section render with `message.blocks?.map(block => ...)` in array order:

- `thinking` → existing `ThinkingBlock` (collapsible; auto-expand while streaming, collapse after — unchanged behavior, now possibly multiple instances)
- `toolCall` → existing `ToolCallCard`
- `text` → existing Markdown render + copy button

Typing indicator / cursor: current behavior preserved (TypingIndicator while streaming, pulse cursor on the last text block). Copy button copies the joined text.

## Compatibility

- No persistence migration: replay derives blocks from data already stored.
- `AgentToolCall` shape unchanged → `ToolCallCard` untouched.
- User messages unchanged → `MessageBubble`, edit flow, TOC anchors, `use-agent-bridge` pending-edit ref untouched.
- `ChatPanel` uses `message.role` and `message.content` only for user messages → untouched.
- Downgrade path: session files remain valid; older UI code reading flat fields is replaced in the same commit (single-repo atomic change).

## Trade-offs

- **Keeping `content` on assistant messages (joined text) vs. removing it**: kept, to avoid churn in `ChatPanel`/bridge; cost is one extra string join per update (negligible at chat scale, messages are bounded by 64 KB prompt/answer sizes).
- **Block-merge continuation heuristic vs. keying by `contentIndex`**: heuristic chosen; simpler, and the event stream guarantees at most one open thinking run at a time.
- **Not introducing per-part stable ids**: Vercel AI SDK uses keyed parts for React identity; here blocks are only ever appended or mutated at the tail of the last message, so array index keys suffice. Revisit if per-block memoization becomes necessary.

## Rollback

Single-commit revert; no data written in the new format (session files untouched), so rollback is clean.
