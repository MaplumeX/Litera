export type AgentStatus =
  | "idle"
  | "loadingBook"
  | "bookReady"
  | "prompting"
  | "error";

export interface AgentError {
  scope: string;
  message: string;
  recoverable: boolean;
  requestId?: string;
  bookId?: string;
  sessionId?: string;
  promptId?: string;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  systemPrompt?: string;
}

export interface AgentToolCall {
  toolCallId: string;
  tool: string;
  params: unknown;
  result?: unknown;
  done: boolean;
  isError?: boolean;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  selection?: string;
  chapterHref?: string;
  toolCalls?: AgentToolCall[];
}

type EventEnvelope = {
  version: number;
};

type RequestCorrelation = { requestId?: string };
type BookCorrelation = { bookId: string };
type PromptCorrelation = BookCorrelation & { sessionId: string; promptId: string };

export type AgentEvent = EventEnvelope & (
  | ({ type: "book_loading" } & BookCorrelation & RequestCorrelation)
  | ({ type: "book_ready" } & BookCorrelation & RequestCorrelation)
  | ({ type: "book_closed"; bookId?: string } & RequestCorrelation)
  | ({ type: "prompt_started" } & PromptCorrelation & RequestCorrelation)
  | ({ type: "text_delta"; delta: string } & PromptCorrelation)
  | ({ type: "tool_start"; toolCallId: string; tool: string; params: unknown } & PromptCorrelation)
  | ({ type: "tool_end"; toolCallId: string; result: unknown; isError: boolean } & PromptCorrelation)
  | ({ type: "compaction_started" } & PromptCorrelation)
  | ({ type: "compaction_completed" } & PromptCorrelation)
  | ({ type: "compaction_failed" } & PromptCorrelation)
  | ({ type: "prompt_end" } & PromptCorrelation)
  | ({ type: "prompt_aborted" } & PromptCorrelation & RequestCorrelation)
  | ({ type: "session_created" } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_switched"; messages: AgentMessage[] } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_rewound"; messages: AgentMessage[] } & PromptCorrelation & RequestCorrelation)
  | ({ type: "session_deleted" } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_renamed"; title: string } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_config_updated"; systemPrompt?: string } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "sessions_list"; sessions: AgentSessionSummary[] } & BookCorrelation & RequestCorrelation)
  | ({ type: "error" } & AgentError)
);
