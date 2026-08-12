export const AGENT_PROTOCOL_VERSION = 1 as const;

export type AgentStatus =
  | "starting"
  | "ready"
  | "loadingBook"
  | "bookReady"
  | "prompting"
  | "restarting"
  | "unavailable";

export interface AgentError {
  scope: string;
  message: string;
  recoverable: boolean;
  requestId?: string;
  bookId?: string;
  sessionId?: string;
  promptId?: string;
}

export interface AgentSnapshot {
  protocolVersion: 1;
  version: number;
  generation: number;
  status: AgentStatus;
  bookId?: string;
  sessionId?: string;
  promptId?: string;
  error?: AgentError;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolCall {
  toolCallId: string;
  tool: string;
  params: unknown;
  result?: unknown;
  done: boolean;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  selection?: string;
  chapterIndex?: number;
  toolCalls?: AgentToolCall[];
}

type EventEnvelope = {
  protocolVersion: 1;
  version: number;
  generation: number;
  seq: number;
};

type RequestCorrelation = { requestId?: string };
type BookCorrelation = { bookId: string };
type PromptCorrelation = BookCorrelation & { sessionId: string; promptId: string };

export type AgentEvent = EventEnvelope & (
  | { type: "ready" }
  | ({ type: "pong"; fts5: boolean } & RequestCorrelation)
  | ({ type: "book_loading" } & BookCorrelation & RequestCorrelation)
  | ({ type: "book_ready" } & BookCorrelation & RequestCorrelation)
  | ({ type: "book_closed"; bookId?: string } & RequestCorrelation)
  | ({ type: "prompt_started" } & PromptCorrelation & RequestCorrelation)
  | ({ type: "text_delta"; delta: string } & PromptCorrelation)
  | ({ type: "tool_start"; toolCallId: string; tool: string; params: unknown } & PromptCorrelation)
  | ({ type: "tool_end"; toolCallId: string; result: unknown; isError: boolean } & PromptCorrelation)
  | ({ type: "prompt_end" } & PromptCorrelation)
  | ({ type: "prompt_aborted" } & PromptCorrelation & RequestCorrelation)
  | ({ type: "session_created" } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_switched"; messages: AgentMessage[] } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_rewound"; messages: AgentMessage[] } & PromptCorrelation & RequestCorrelation)
  | ({ type: "session_deleted" } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_renamed"; title: string } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "sessions_list"; sessions: AgentSessionSummary[] } & BookCorrelation & RequestCorrelation)
  | ({ type: "error" } & AgentError)
  | { type: "supervisor_status"; status: AgentStatus; message?: string }
  | ({ type: "prompt_interrupted"; message: string } & PromptCorrelation)
);
