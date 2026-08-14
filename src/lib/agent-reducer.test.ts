import { describe, expect, it } from "vitest";
import { agentReducer, createAgentState, type AgentState } from "./agent-reducer";
import type { AgentEvent } from "@/types/agent";

function reduce(state: AgentState, event: AgentEvent): AgentState {
  return agentReducer(state, { type: "event", event });
}

describe("agentReducer", () => {
  it("ignores reverse session-list responses from another book or request", () => {
    let state = createAgentState("book-b");
    state = agentReducer(state, { type: "session_list_requested", requestId: "list-b" });
    state = reduce(state, { version: 1, type: "sessions_list", requestId: "list-a", bookId: "book-a", sessions: [] });
    state = reduce(state, { version: 2, type: "sessions_list", requestId: "list-b", bookId: "book-b", sessions: [{ id: "b", title: "B", createdAt: "1", updatedAt: "1" }] });
    expect(state.sessions.map((session) => session.id)).toEqual(["b"]);
  });

  it("rejects stale prompt deltas after a book switch", () => {
    let state = createAgentState("book-a");
    state = reduce(state, { version: 1, type: "prompt_started", bookId: "book-a", sessionId: "s", promptId: "p" });
    state = agentReducer(state, { type: "book_changed", bookId: "book-b" });
    state = reduce(state, { version: 2, type: "text_delta", bookId: "book-a", sessionId: "s", promptId: "p", delta: "stale" });
    expect(state.messages).toEqual([]);
  });

  it("matches concurrent tool completion by toolCallId", () => {
    let state = createAgentState("book-a");
    state = reduce(state, { version: 1, type: "prompt_started", bookId: "book-a", sessionId: "s", promptId: "p" });
    state = reduce(state, { version: 2, type: "tool_start", bookId: "book-a", sessionId: "s", promptId: "p", toolCallId: "one", tool: "read_chapter", params: {} });
    state = reduce(state, { version: 3, type: "tool_start", bookId: "book-a", sessionId: "s", promptId: "p", toolCallId: "two", tool: "read_chapter", params: {} });
    state = reduce(state, { version: 4, type: "tool_end", bookId: "book-a", sessionId: "s", promptId: "p", toolCallId: "two", result: "done", isError: false });
    expect(state.messages[0].toolCalls).toEqual([
      expect.objectContaining({ toolCallId: "one", done: false }),
      expect.objectContaining({ toolCallId: "two", done: true, result: "done" }),
    ]);
  });

  it("does not clear a live prompt for an unrelated error", () => {
    let state = createAgentState("book-a");
    state = reduce(state, { version: 1, type: "prompt_started", bookId: "book-a", sessionId: "s", promptId: "p" });
    state = reduce(state, { version: 2, type: "error", bookId: "book-a", scope: "list", message: "failed", recoverable: true });
    expect(state.status).toBe("prompting");
    expect(state.promptId).toBe("p");
  });

  it("keeps the queued user message when a prompt creates its first session", () => {
    let state = createAgentState("book-a");
    state = agentReducer(state, { type: "prompt_queued", bookId: "book-a", promptId: "p" });
    state = agentReducer(state, { type: "user_message", message: { role: "user", content: "question" } });
    state = reduce(state, { version: 1, type: "prompt_started", bookId: "book-a", sessionId: "s", promptId: "p" });
    expect(state.messages).toEqual([{ role: "user", content: "question" }]);
  });

  it("optimistically inserts and later refreshes a new session", () => {
    let state = createAgentState("book-a");
    state = reduce(state, { version: 1, type: "session_created", bookId: "book-a", sessionId: "new" });
    expect(state.sessions[0].title).toBe("新会话");
    state = agentReducer(state, { type: "session_list_requested", requestId: "list" });
    state = reduce(state, { version: 2, type: "sessions_list", requestId: "list", bookId: "book-a", sessions: [{ id: "new", title: "Title", createdAt: "1", updatedAt: "2" }] });
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].title).toBe("Title");
  });
});
