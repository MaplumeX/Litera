import type {
  AgentError,
  AgentEvent,
  AgentMessage,
  AgentSessionSummary,
  AgentStatus,
} from "@/types/agent";
import { t } from "@/lib/i18n";

export interface AgentState {
  version: number;
  status: AgentStatus;
  activeBookId: string | null;
  sessionId: string | null;
  promptId: string | null;
  messages: AgentMessage[];
  sessions: AgentSessionSummary[];
  error: AgentError | null;
  sessionListRequestId: string | null;
}

export type AgentAction =
  | { type: "book_changed"; bookId: string | null }
  | { type: "event"; event: AgentEvent }
  | { type: "session_list_requested"; requestId: string }
  | { type: "prompt_queued"; bookId: string; promptId: string }
  | { type: "prompt_queue_failed"; promptId: string; message: string }
  | { type: "user_message"; message: AgentMessage }
  | { type: "clear_error" };

export function createAgentState(bookId: string | null = null): AgentState {
  return {
    version: 0,
    status: bookId ? "loadingBook" : "idle",
    activeBookId: bookId,
    sessionId: null,
    promptId: null,
    messages: [],
    sessions: [],
    error: null,
    sessionListRequestId: null,
  };
}

function matchesBook(state: AgentState, bookId?: string): boolean {
  return !bookId || (!!state.activeBookId && state.activeBookId === bookId);
}

function upsertSession(
  sessions: AgentSessionSummary[],
  summary: AgentSessionSummary,
): AgentSessionSummary[] {
  const index = sessions.findIndex((session) => session.id === summary.id);
  if (index === -1) return [summary, ...sessions];
  const next = sessions.slice();
  next[index] = summary;
  return next;
}

function matchesPrompt(
  state: AgentState,
  event: { bookId: string; sessionId: string; promptId: string },
): boolean {
  return state.activeBookId === event.bookId
    && state.sessionId === event.sessionId
    && state.promptId === event.promptId;
}

function updateLastAssistant(
  messages: AgentMessage[],
  update: (message: AgentMessage) => AgentMessage,
): AgentMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return [...messages.slice(0, -1), update(last)];
  }
  return [...messages, update({ role: "assistant", content: "" })];
}

function applyEvent(state: AgentState, event: AgentEvent): AgentState {
  if (event.version <= state.version) return state;
  const base = { ...state, version: event.version };

  switch (event.type) {
    case "book_loading":
      return matchesBook(base, event.bookId)
        ? { ...base, status: "loadingBook", sessionId: null, promptId: null, messages: [], sessions: [], error: null }
        : base;
    case "book_ready":
      return matchesBook(base, event.bookId) ? { ...base, status: "bookReady", error: null } : base;
    case "book_closed":
      return matchesBook(base, event.bookId)
        ? { ...base, status: "idle", sessionId: null, promptId: null, messages: [], sessions: [], error: null }
        : base;
    case "prompt_started":
      return matchesBook(base, event.bookId)
        ? { ...base, status: "prompting", sessionId: event.sessionId, promptId: event.promptId, error: null }
        : base;
    case "text_delta":
      if (!matchesPrompt(base, event)) return base;
      return {
        ...base,
        messages: updateLastAssistant(base.messages, (message) => ({
          ...message,
          content: message.content + event.delta,
        })),
      };
    case "tool_start":
      if (!matchesPrompt(base, event)) return base;
      return {
        ...base,
        messages: updateLastAssistant(base.messages, (message) => ({
          ...message,
          toolCalls: [
            ...(message.toolCalls ?? []),
            {
              toolCallId: event.toolCallId,
              tool: event.tool,
              params: event.params,
              done: false,
            },
          ],
        })),
      };
    case "tool_end":
      if (!matchesPrompt(base, event)) return base;
      return {
        ...base,
        messages: updateLastAssistant(base.messages, (message) => ({
          ...message,
          toolCalls: message.toolCalls?.map((call) => call.toolCallId === event.toolCallId
            ? { ...call, result: event.result, done: true, isError: event.isError }
            : call),
        })),
      };
    case "prompt_end":
    case "prompt_aborted":
      return matchesPrompt(base, event)
        ? { ...base, status: "bookReady", promptId: null }
        : base;
    case "session_created":
      return matchesBook(base, event.bookId)
        ? {
            ...base,
            sessionId: event.sessionId,
            messages: base.promptId ? base.messages : [],
            error: null,
            sessions: upsertSession(base.sessions, {
              id: event.sessionId,
              title: t("chat.newSessionTitle"),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          }
        : base;
    case "session_switched":
      return matchesBook(base, event.bookId)
        ? { ...base, sessionId: event.sessionId, promptId: null, messages: event.messages, status: "bookReady", error: null }
        : base;
    case "session_rewound":
      return matchesBook(base, event.bookId)
        ? { ...base, sessionId: event.sessionId, messages: event.messages, error: null }
        : base;
    case "session_deleted":
      if (!matchesBook(base, event.bookId)) return base;
      return {
        ...base,
        sessionId: base.sessionId === event.sessionId ? null : base.sessionId,
        messages: base.sessionId === event.sessionId ? [] : base.messages,
        sessions: base.sessions.filter((session) => session.id !== event.sessionId),
      };
    case "session_renamed":
      if (!matchesBook(base, event.bookId)) return base;
      return {
        ...base,
        sessions: upsertSession(base.sessions, {
          ...base.sessions.find((session) => session.id === event.sessionId) ?? {
            id: event.sessionId,
            title: event.title,
            createdAt: new Date().toISOString(),
          },
          title: event.title,
          updatedAt: new Date().toISOString(),
        }),
      };
    case "session_config_updated":
      if (!matchesBook(base, event.bookId)) return base;
      return {
        ...base,
        sessions: upsertSession(base.sessions, {
          ...base.sessions.find((session) => session.id === event.sessionId) ?? {
            id: event.sessionId,
            title: t("chat.newSessionTitle"),
            createdAt: new Date().toISOString(),
          },
          ...(event.systemPrompt !== undefined ? { systemPrompt: event.systemPrompt } : {}),
          ...(event.thinkingLevel !== undefined ? { thinkingLevel: event.thinkingLevel } : {}),
          updatedAt: new Date().toISOString(),
        }),
      };
    case "sessions_list":
      if (!matchesBook(base, event.bookId) || event.requestId !== base.sessionListRequestId) return base;
      return { ...base, sessions: event.sessions, sessionListRequestId: null };
    case "error": {
      if (!matchesBook(base, event.bookId)) return base;
      if (event.promptId && (
        event.promptId !== base.promptId
        || (!!event.sessionId && event.sessionId !== base.sessionId)
      )) return base;
      const matchesActivePrompt = !!event.promptId && event.promptId === base.promptId;
      return {
        ...base,
        status: matchesActivePrompt ? "bookReady" : event.scope === "book" ? "error" : base.status,
        promptId: matchesActivePrompt ? null : base.promptId,
        error: {
          scope: event.scope,
          message: event.message,
          recoverable: event.recoverable,
          requestId: event.requestId,
          bookId: event.bookId,
          sessionId: event.sessionId,
          promptId: event.promptId,
        },
      };
    }
  }
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "book_changed":
      return {
        ...createAgentState(action.bookId),
        version: state.version,
        status: action.bookId ? "loadingBook" : "idle",
      };
    case "event":
      return applyEvent(state, action.event);
    case "session_list_requested":
      return { ...state, sessionListRequestId: action.requestId };
    case "prompt_queued":
      if (state.activeBookId !== action.bookId) return state;
      return { ...state, status: "prompting", promptId: action.promptId, error: null };
    case "prompt_queue_failed":
      if (state.promptId !== action.promptId) return state;
      return {
        ...state,
        status: state.activeBookId ? "bookReady" : "idle",
        promptId: null,
        error: {
          scope: "prompt",
          message: action.message,
          recoverable: true,
          bookId: state.activeBookId ?? undefined,
          promptId: action.promptId,
        },
      };
    case "user_message":
      return { ...state, messages: [...state.messages, action.message], error: null };
    case "clear_error":
      return { ...state, error: null };
  }
}
