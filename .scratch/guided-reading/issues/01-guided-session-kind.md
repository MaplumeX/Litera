# 01: Guided session kind

**Status:** resolved

**What to build:** A Session can be created as a Guided session. The new-Session control offers "New chat" and "New guided reading"; the latter asks for a starting chapter (defaulting to the current scope or the first chapter). The kind is fixed for the Session's life.

- [x] Session kind persisted with the Session and exposed on `AgentSessionSummary`
- [x] New-Session control offers both kinds; guided asks for a start chapter
- [x] Session list marks Guided sessions and shows the guide cursor (e.g. "Ch. 5 · 2/3")
- [x] Ordinary Sessions behave exactly as today
- [x] Synced Sessions keep their kind on other devices
- [x] Tests: session decode/summary round-trips the kind; Session list renders the marker

**Notes:** `sessionSummary` in `src/agent/sessions/pi-session.ts` and `AgentSessionSummary` in `src/types/agent.ts` already carry an optional `systemPrompt`; the kind can follow the same path. Decide whether it lives in the header or a first `session_config`-like entry; the header is simplest if Pi session v3 tolerates an extra field.

## Comments

- The start chapter is not a separate picker: a new Guided session starts from the discussion scope (pick a chapter in the TOC) or, without one, the Book pane's position. Its first step's button reads "开始带读：<chapter>", so the start is visible before anything is sent.
- The kind lives in the session header (`"kind": "guided"`), written by `create_with_kind` in `src-tauri/src/pi_sessions.rs`; sync carries the header, so other devices see it (Rust test `a_guided_session_synced_from_another_device_keeps_its_kind`).
- "New chat" no longer reuses an empty Guided session, and "New guided reading" reuses only an empty Guided one.
