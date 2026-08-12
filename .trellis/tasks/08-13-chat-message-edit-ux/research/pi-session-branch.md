# pi SessionManager branching for ChatGPT-style edit

## What we need

Edit a historical user message, drop the current view of everything from that message onward, then `prompt()` the new text in the same session file. No branch switcher in this task.

## SDK facts

Source: `sidecar/node_modules/@earendil-works/pi-coding-agent`.

- Sessions are an append-only JSONL tree (`id` / `parentId`). Old paths stay on disk after a branch.
- `SessionManager.branch(entryId)` only moves `leafId`. Next append becomes a child of that entry. It does **not** rebuild `AgentSession.messages`.
- `AgentSession.messages` is `agent.state.messages` (in-memory). After `branch()` alone, file leaf and in-memory history diverge.
- Official in-file navigation is `AgentSession.navigateTree(targetId)`:
  - If target is a **user** message: new leaf = `target.parentId` (the user message itself leaves the active path). `resetLeaf()` when parent is null.
  - Then `agent.state.messages = sessionManager.buildSessionContext().messages`.
  - Throws if `isStreaming`.
  - Stays in the same session file (unlike `AgentSessionRuntime.fork()`).
- `getUserMessagesForForking()` walks **all** entries in the file, including abandoned branches. Do **not** use it to map the visible chat list after prior edits.

## Mapping a UI index to an entry

Frontend `state.messages` is `serializeMessages(session.messages)`: user + assistant only, active path only.

Sidecar must walk `sessionManager.getBranch()` (leaf → root; reverse for chronological), keep `type === "message"` with `role` user/assistant in the same order as `serializeMessages`, and take `entries[messageIndex]`. Reject if missing or not user.

## Reading-context asides

`handlePrompt` may append a `customType: "readingContext"` custom message immediately before the user message (`nextTurn`).

`navigateTree(userEntry)` then leaves that old `readingContext` on the path. A new aside + prompt would stack two selections.

If the user entry's parent is a `custom_message` / `custom` with `customType === "readingContext"`, call `navigateTree` on **that parent** instead, so the old aside also leaves the path. Keep `bookSnapshot`.

## Do not use

- `AgentSessionRuntime.fork()` — new session file, new session id, extra list/UI work.
- `branchWithSummary` — would inject a branch summary into context; no switcher to justify it.
- Mutating or deleting JSONL entries — append-only.
