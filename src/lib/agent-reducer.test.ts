import { describe, expect, it } from "vitest";
import { agentReducer, createAgentState, type AgentState } from "./agent-reducer";
import type { AgentEvent } from "@/types/agent";

function reduce(state: AgentState, event: Omit<AgentEvent, "protocolVersion" | "generation">): AgentState {
  return agentReducer(state, {
    type: "event",
    event: { protocolVersion: 1, generation: 1, ...event } as AgentEvent,
  });
}

describe("agentReducer", () => {
  it("ignores reverse session list responses from another book or request", () => {
    let state = createAgentState("book-b");
    state = agentReducer(state, { type: "session_list_requested", requestId: "list-b" });
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "sessions_list",
      requestId: "list-a",
      bookId: "book-a",
      sessions: [{ id: "a", title: "A", createdAt: "1", updatedAt: "1" }],
    });
    state = reduce(state, {
      version: 2,
      seq: 2,
      type: "sessions_list",
      requestId: "list-b",
      bookId: "book-b",
      sessions: [{ id: "b", title: "B", createdAt: "1", updatedAt: "1" }],
    });
    expect(state.sessions.map((session) => session.id)).toEqual(["b"]);
  });

  it("rejects stale prompt deltas after a book switch", () => {
    let state = createAgentState("book-a");
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "prompt_started",
      requestId: "r",
      bookId: "book-a",
      sessionId: "session-a",
      promptId: "prompt-a",
    });
    state = agentReducer(state, { type: "book_changed", bookId: "book-b" });
    state = reduce(state, {
      version: 2,
      seq: 2,
      type: "text_delta",
      bookId: "book-a",
      sessionId: "session-a",
      promptId: "prompt-a",
      delta: "stale",
    });
    expect(state.activeBookId).toBe("book-b");
    expect(state.messages).toEqual([]);
  });

  it("matches concurrent tool completion by toolCallId", () => {
    let state = createAgentState("book-a");
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "prompt_started",
      requestId: "r",
      bookId: "book-a",
      sessionId: "session-a",
      promptId: "prompt-a",
    });
    for (const [version, toolCallId] of [[2, "tool-1"], [3, "tool-2"]] as const) {
      state = reduce(state, {
        version,
        seq: version,
        type: "tool_start",
        bookId: "book-a",
        sessionId: "session-a",
        promptId: "prompt-a",
        toolCallId,
        tool: "read_chapter",
        params: { index: version },
      });
    }
    state = reduce(state, {
      version: 4,
      seq: 4,
      type: "tool_end",
      bookId: "book-a",
      sessionId: "session-a",
      promptId: "prompt-a",
      toolCallId: "tool-2",
      result: "second",
      isError: false,
    });
    expect(state.messages[0].toolCalls).toEqual([
      expect.objectContaining({ toolCallId: "tool-1", done: false }),
      expect.objectContaining({ toolCallId: "tool-2", done: true, result: "second" }),
    ]);
  });

  it("does not clear a live prompt for an unrelated list error", () => {
    let state = createAgentState("book-a");
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "prompt_started",
      requestId: "prompt-request",
      bookId: "book-a",
      sessionId: "session-a",
      promptId: "prompt-a",
    });
    state = reduce(state, {
      version: 2,
      seq: 2,
      type: "error",
      requestId: "list-request",
      bookId: "book-a",
      scope: "list_sessions",
      message: "list failed",
      recoverable: true,
    });
    expect(state.status).toBe("prompting");
    expect(state.promptId).toBe("prompt-a");
  });

  it("ignores an error from an older prompt in the same book", () => {
    let state = createAgentState("book-a");
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "prompt_started",
      requestId: "new-request",
      bookId: "book-a",
      sessionId: "session-a",
      promptId: "prompt-new",
    });
    state = reduce(state, {
      version: 2,
      seq: 2,
      type: "error",
      requestId: "old-request",
      bookId: "book-a",
      sessionId: "session-a",
      promptId: "prompt-old",
      scope: "prompt",
      message: "old prompt failed late",
      recoverable: true,
    });
    expect(state.status).toBe("prompting");
    expect(state.promptId).toBe("prompt-new");
    expect(state.error).toBeNull();
    expect(state.version).toBe(2);
  });

  it("hydrates an event missed before listener registration", () => {
    const state = agentReducer(createAgentState("book-a"), {
      type: "hydrate",
      snapshot: {
        protocolVersion: 1,
        version: 9,
        generation: 2,
        status: "bookReady",
        bookId: "book-a",
        sessionId: "session-a",
      },
    });
    expect(state).toEqual(expect.objectContaining({
      version: 9,
      generation: 2,
      status: "bookReady",
      sessionId: "session-a",
    }));
  });

  it("keeps the first user message when a prompt auto-creates a session for an empty book", () => {
    let state = createAgentState("book-b");
    state = agentReducer(state, { type: "prompt_queued", bookId: "book-b", promptId: "prompt-b" });
    state = agentReducer(state, {
      type: "user_message",
      message: { role: "user", content: "first question" },
    });
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "prompt_started",
      requestId: "prompt-request",
      bookId: "book-b",
      sessionId: "session-b",
      promptId: "prompt-b",
    });
    expect(state.sessionId).toBe("session-b");
    expect(state.messages).toEqual([{ role: "user", content: "first question" }]);
  });

  it("optimistically inserts a new session on session_created and dedupes on later list", () => {
    let state = createAgentState("book-a");
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "session_created",
      requestId: "new-session",
      bookId: "book-a",
      sessionId: "session-new",
    });
    // New session appears immediately and is current
    expect(state.sessionId).toBe("session-new");
    expect(state.sessions.map((s) => s.id)).toEqual(["session-new"]);
    expect(state.sessions[0].title).toBe("New Session");

    // Duplicate session_created for same id does not create a second entry
    state = reduce(state, {
      version: 2,
      seq: 2,
      type: "session_created",
      requestId: "new-session-2",
      bookId: "book-a",
      sessionId: "session-new",
    });
    expect(state.sessions.map((s) => s.id)).toEqual(["session-new"]);

    // When listSessions returns the persisted session, it replaces the optimistic entry (no duplicate)
    state = agentReducer(state, { type: "session_list_requested", requestId: "list-1" });
    state = reduce(state, {
      version: 3,
      seq: 3,
      type: "sessions_list",
      requestId: "list-1",
      bookId: "book-a",
      sessions: [{ id: "session-new", title: "Real Title", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" }],
    });
    expect(state.sessions.map((s) => s.id)).toEqual(["session-new"]);
    expect(state.sessions[0].title).toBe("Real Title");
  });

  it("ignores session_created from another book", () => {
    let state = createAgentState("book-a");
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "session_created",
      requestId: "new-session",
      bookId: "book-b",
      sessionId: "session-other",
    });
    expect(state.sessions).toEqual([]);
    expect(state.sessionId).toBeNull();
  });

  it("updates title and preserves createdAt on session_renamed", () => {
    let state = createAgentState("book-a");
    state = agentReducer(state, { type: "session_list_requested", requestId: "list-1" });
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "sessions_list",
      requestId: "list-1",
      bookId: "book-a",
      sessions: [{ id: "session-1", title: "Old Title", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:01:00.000Z" }],
    });
    state = reduce(state, {
      version: 2,
      seq: 2,
      type: "session_renamed",
      requestId: "rename-1",
      bookId: "book-a",
      sessionId: "session-1",
      title: "New Title",
    });
    expect(state.sessions).toEqual([
      { id: "session-1", title: "New Title", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: expect.any(String) },
    ]);
  });

  it("ignores session_renamed from another book", () => {
    let state = createAgentState("book-a");
    state = agentReducer(state, { type: "session_list_requested", requestId: "list-1" });
    state = reduce(state, {
      version: 1,
      seq: 1,
      type: "sessions_list",
      requestId: "list-1",
      bookId: "book-a",
      sessions: [{ id: "session-1", title: "Old Title", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:01:00.000Z" }],
    });
    state = reduce(state, {
      version: 2,
      seq: 2,
      type: "session_renamed",
      requestId: "rename-1",
      bookId: "book-b",
      sessionId: "session-1",
      title: "New Title",
    });
    expect(state.sessions[0].title).toBe("Old Title");
  });
});
