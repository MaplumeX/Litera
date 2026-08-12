# Fix prompt context injection polluting user messages

## Problem

`handlePrompt` in `sidecar/index.ts` builds the full prompt string via
`buildPromptWithContext`, which concatenates context lines (e.g.
`（当前在第 N 章）`, `用户选中的文本：...`) **into** the user's original
text, then passes the combined string to `session.prompt(fullPrompt)`.

The SDK stores that string verbatim as a `user` role message in session
history. When the session is later switched / replayed,
`serializeMessages` → `extractUserText` returns the combined string, so
the chat panel displays the LM-facing context wrapper (`（当前在第 0 章）`,
`用户问题：`) as if it were the user's own words.

## Root cause

Context is injected by mutating the user message text instead of by
emitting a separate context message alongside it. The `AgentSession`
SDK already supports this: `sendCustomMessage(msg, { triggerTurn: false,
deliverAs: "nextTurn" })` queues an "aside" into
`_pendingNextTurnMessages` that is delivered with the next user prompt
without triggering a turn on its own, and `prompt(text)` then stores
only the user's original text as the user message.

## Requirements

1. User messages persisted in session history must contain **only** the
   user's original input text — no `用户问题：` prefix, no
   `（当前在第 N 章）`, no `用户选中的文本：` wrapper. The aside message
   injected to the model also must not add a `用户问题：` label (the user
   message is delivered separately, so the label is redundant).
2. The LM must still receive the reading context (chapter index and/or
   selected text) for each prompt.
3. Context delivery must use the SDK's "nextTurn" aside mechanism
   (`sendCustomMessage` with `triggerTurn: false`, `deliverAs:
   "nextTurn"`) so it is attached to the following `prompt()` turn and
   does not itself start a turn.
4. `buildPromptWithContext` must be removed; the user text passed to
   `session.prompt()` is the raw `command.text`.
5. Existing sessions (already persisted with polluted user messages)
   are not migrated — only new prompts are affected. No data migration
   is in scope.
6. No frontend changes are required; `serializeMessages` /
   `extractUserText` already return whatever the user message stores, so
   storing clean text fixes the display automatically.

## Acceptance criteria

- [ ] In a fresh session, sending a prompt with `chapterIndex` set and
      no `selection` produces a user message whose stored/serialized
      content equals the original input text exactly (no
      `（当前在第 ...）`, no `用户问题：`).
- [ ] Sending a prompt with `selection` set produces a user message
      whose stored/serialized content equals the original input text
      exactly (no `用户选中的文本：` wrapper).
- [ ] The LM response references the chapter / selection context
      correctly, proving the aside was delivered to the model.
- [ ] `buildPromptWithContext` is deleted from `sidecar/index.ts`.
- [ ] `sidecar` type-checks and builds (`npm run -w sidecar build` or
      equivalent) with no new errors.

## Out of scope

- Frontend rendering changes.
- Migration / cleanup of existing sessions that already contain
  polluted user messages.
- The aside wording: keep `用户选中的文本：` / `（当前在第 N 章）`
  phrasing for context, but **drop** the `用户问题：` label — it was
  only needed when everything was concatenated into one string.