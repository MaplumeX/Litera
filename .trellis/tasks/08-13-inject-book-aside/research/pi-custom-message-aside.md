# pi SDK: custom-message aside and session reload

Inspected `@earendil-works/pi-coding-agent` 0.84.x (`sidecar/node_modules`).

## Delivery

`AgentSession.sendCustomMessage(message, options)` (`dist/core/agent-session.js:1068`):

- `deliverAs: "nextTurn"` pushes onto `_pendingNextTurnMessages`. Nothing is persisted yet. The next `prompt()` consumes the queue and includes those custom messages in the turn.
- Idle + no `deliverAs` + `triggerTurn: false` appends immediately to `agent.state.messages` and `sessionManager.appendCustomMessageEntry(...)`.
- `triggerTurn: true` starts an LLM turn. Do not use that for book snapshots.

Existing reading-context injection already uses `nextTurn`. Book snapshot must use the same options so it rides with the user prompt and does not start its own turn.

## Persistence and reload

`custom_message` session entries **do** participate in LLM context. On load, `sessionEntryToContextMessages` reconstructs them via `createCustomMessage(...)` (`dist/core/session-manager.js:177-180`).

Shape:

```ts
{ role: "custom", customType: string, content: string | Content[], display: boolean, details?: unknown, timestamp: number }
```

Idempotency check: `session.messages` contains `role === "custom" && customType === "bookSnapshot"`. After the first delivered turn, and after `loadSessionFromDisk`, this is true.

`display: false` only affects pi TUI. Litera's `serializeMessages` ignores non-user/assistant roles, so the snapshot never reaches the chat UI.

## Session titles

`SessionManager.list` `firstMessage` only reads `role === "user"` (`dist/core/session-manager.js:483`). A custom aside cannot become the session title.

## Compaction

If compaction drops the custom message, the next prompt will not see `bookSnapshot` and will inject again. That is the desired recovery.

## Do not persist at `createSession`

Immediate persist (no `nextTurn`) would write the snapshot before any user prompt. `nextTurn` on the first `handlePrompt` matches the chosen product behavior and shares the reading-context path.
