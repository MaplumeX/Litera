export const AGENT_PROTOCOL_VERSION = 1 as const;
export const MAX_JSONL_BYTES = 1024 * 1024;
export const MAX_ID_LENGTH = 128;
export const MAX_PROMPT_LENGTH = 64 * 1024;
export const MAX_SELECTION_LENGTH = 64 * 1024;
export const MAX_SESSION_TITLE_LENGTH = 128;

export interface PromptContext {
  selection?: string;
  chapterHref?: string;
}

export type SidecarCommand =
  | { protocolVersion: 1; type: "ping"; requestId: string }
  | { protocolVersion: 1; type: "configure"; requestId: string; agentDir: string }
  | { protocolVersion: 1; type: "open_book"; requestId: string; bookId: string; path: string; sessionsDir: string }
  | { protocolVersion: 1; type: "close_book"; requestId: string; bookId?: string }
  | { protocolVersion: 1; type: "prompt"; requestId: string; promptId: string; bookId: string; text: string; context?: PromptContext }
  | { protocolVersion: 1; type: "edit_prompt"; requestId: string; promptId: string; bookId: string; messageIndex: number; text: string; context?: PromptContext }
  | { protocolVersion: 1; type: "abort"; requestId: string; promptId?: string }
  | { protocolVersion: 1; type: "list_sessions"; requestId: string; bookId: string }
  | { protocolVersion: 1; type: "new_session"; requestId: string; bookId: string }
  | { protocolVersion: 1; type: "switch_session"; requestId: string; bookId: string; sessionId: string }
  | { protocolVersion: 1; type: "delete_session"; requestId: string; bookId: string; sessionId: string }
  | { protocolVersion: 1; type: "rename_session"; requestId: string; bookId: string; sessionId: string; title: string };

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedToolCall {
  toolCallId: string;
  tool: string;
  params: unknown;
  result?: unknown;
  done: boolean;
}

export interface SerializedMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: SerializedToolCall[];
}

type EventBase = { protocolVersion: 1; seq: number };
type RequestCorrelation = { requestId?: string };
type BookCorrelation = { bookId: string };
type PromptCorrelation = BookCorrelation & { sessionId: string; promptId: string };

export type SidecarEvent = EventBase & (
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
  | ({ type: "session_switched"; messages: SerializedMessage[] } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_rewound"; messages: SerializedMessage[] } & PromptCorrelation & RequestCorrelation)
  | ({ type: "session_deleted" } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_renamed"; title: string } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "sessions_list"; sessions: SessionSummary[] } & BookCorrelation & RequestCorrelation)
  | ({
      type: "error";
      scope: string;
      message: string;
      recoverable: boolean;
      requestId?: string;
      bookId?: string;
      sessionId?: string;
      promptId?: string;
    })
);

export class ProtocolDecodeError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolDecodeError("Protocol message must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, max = MAX_ID_LENGTH): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new ProtocolDecodeError(`Invalid ${field}`);
  }
  return value;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    throw new ProtocolDecodeError(`Invalid ${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string, max = MAX_ID_LENGTH): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, max);
}

function finiteInteger(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new ProtocolDecodeError(`Invalid ${field}`);
  }
  return value;
}

function decodeContext(value: unknown): PromptContext | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  const selection = optionalString(input.selection, "context.selection", MAX_SELECTION_LENGTH);
  const chapterHref = optionalString(input.chapterHref, "context.chapterHref", 4096);
  return { selection, chapterHref };
}

function assertEnvelope(input: Record<string, unknown>): string {
  if (input.protocolVersion !== AGENT_PROTOCOL_VERSION) {
    throw new ProtocolDecodeError("Unsupported protocolVersion");
  }
  return requiredString(input.type, "type", 64);
}

export function decodeCommand(value: unknown): SidecarCommand {
  const input = record(value);
  const type = assertEnvelope(input);
  const requestId = requiredString(input.requestId, "requestId");
  const protocolVersion = AGENT_PROTOCOL_VERSION;
  switch (type) {
    case "ping":
      return { protocolVersion, type, requestId };
    case "configure":
      return {
        protocolVersion,
        type,
        requestId,
        agentDir: requiredString(input.agentDir, "agentDir", 4096),
      };
    case "open_book":
      return {
        protocolVersion,
        type,
        requestId,
        bookId: requiredString(input.bookId, "bookId"),
        path: requiredString(input.path, "path", 4096),
        sessionsDir: requiredString(input.sessionsDir, "sessionsDir", 4096),
      };
    case "close_book":
      return { protocolVersion, type, requestId, bookId: optionalString(input.bookId, "bookId") };
    case "prompt":
      return {
        protocolVersion,
        type,
        requestId,
        promptId: requiredString(input.promptId, "promptId"),
        bookId: requiredString(input.bookId, "bookId"),
        text: requiredString(input.text, "text", MAX_PROMPT_LENGTH),
        context: decodeContext(input.context),
      };
    case "edit_prompt":
      return {
        protocolVersion,
        type,
        requestId,
        promptId: requiredString(input.promptId, "promptId"),
        bookId: requiredString(input.bookId, "bookId"),
        messageIndex: finiteInteger(input.messageIndex, "messageIndex"),
        text: requiredString(input.text, "text", MAX_PROMPT_LENGTH),
        context: decodeContext(input.context),
      };
    case "abort":
      return { protocolVersion, type, requestId, promptId: optionalString(input.promptId, "promptId") };
    case "list_sessions":
    case "new_session":
      return { protocolVersion, type, requestId, bookId: requiredString(input.bookId, "bookId") };
    case "switch_session":
    case "delete_session":
      return {
        protocolVersion,
        type,
        requestId,
        bookId: requiredString(input.bookId, "bookId"),
        sessionId: requiredString(input.sessionId, "sessionId"),
      };
    case "rename_session":
      return {
        protocolVersion,
        type,
        requestId,
        bookId: requiredString(input.bookId, "bookId"),
        sessionId: requiredString(input.sessionId, "sessionId"),
        title: requiredString(input.title, "title", MAX_SESSION_TITLE_LENGTH),
      };
    default:
      throw new ProtocolDecodeError(`Unknown command type: ${type}`);
  }
}

function decodeToolCalls(value: unknown): SerializedToolCall[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ProtocolDecodeError("Invalid toolCalls");
  return value.map((item) => {
    const input = record(item);
    if (typeof input.done !== "boolean") throw new ProtocolDecodeError("Invalid toolCalls.done");
    return {
      toolCallId: requiredString(input.toolCallId, "toolCallId"),
      tool: requiredString(input.tool, "tool", 128),
      params: input.params,
      result: input.result,
      done: input.done,
    };
  });
}

function decodeMessages(value: unknown): SerializedMessage[] {
  if (!Array.isArray(value)) throw new ProtocolDecodeError("Invalid messages");
  return value.map((item) => {
    const input = record(item);
    const role = input.role;
    if (role !== "user" && role !== "assistant") throw new ProtocolDecodeError("Invalid message role");
    return {
      role,
      content: boundedString(input.content, "message.content", MAX_PROMPT_LENGTH * 4),
      toolCalls: decodeToolCalls(input.toolCalls),
    };
  });
}

function decodeSessions(value: unknown): SessionSummary[] {
  if (!Array.isArray(value)) throw new ProtocolDecodeError("Invalid sessions");
  return value.map((item) => {
    const input = record(item);
    return {
      id: requiredString(input.id, "session.id"),
      title: requiredString(input.title, "session.title", 1024),
      createdAt: requiredString(input.createdAt, "session.createdAt", 128),
      updatedAt: requiredString(input.updatedAt, "session.updatedAt", 128),
    };
  });
}

export function decodeEvent(value: unknown): SidecarEvent {
  const input = record(value);
  const type = assertEnvelope(input);
  const protocolVersion = AGENT_PROTOCOL_VERSION;
  const seq = finiteInteger(input.seq, "seq", 1);
  const requestId = optionalString(input.requestId, "requestId");
  const bookId = () => requiredString(input.bookId, "bookId");
  const sessionId = () => requiredString(input.sessionId, "sessionId");
  const promptId = () => requiredString(input.promptId, "promptId");
  const correlation = () => ({ bookId: bookId(), sessionId: sessionId(), promptId: promptId() });
  switch (type) {
    case "ready":
      return { protocolVersion, seq, type };
    case "pong":
      if (typeof input.fts5 !== "boolean") throw new ProtocolDecodeError("Invalid fts5");
      return { protocolVersion, seq, type, requestId, fts5: input.fts5 };
    case "book_loading":
    case "book_ready":
      return { protocolVersion, seq, type, requestId, bookId: bookId() };
    case "book_closed":
      return { protocolVersion, seq, type, requestId, bookId: optionalString(input.bookId, "bookId") };
    case "prompt_started":
    case "prompt_aborted":
      return { protocolVersion, seq, type, requestId, ...correlation() };
    case "text_delta":
      return { protocolVersion, seq, type, ...correlation(), delta: requiredString(input.delta, "delta", MAX_PROMPT_LENGTH) };
    case "tool_start":
      return {
        protocolVersion,
        seq,
        type,
        ...correlation(),
        toolCallId: requiredString(input.toolCallId, "toolCallId"),
        tool: requiredString(input.tool, "tool", 128),
        params: input.params,
      };
    case "tool_end":
      if (typeof input.isError !== "boolean") throw new ProtocolDecodeError("Invalid isError");
      return {
        protocolVersion,
        seq,
        type,
        ...correlation(),
        toolCallId: requiredString(input.toolCallId, "toolCallId"),
        result: input.result,
        isError: input.isError,
      };
    case "prompt_end":
      return { protocolVersion, seq, type, ...correlation() };
    case "session_created":
    case "session_deleted":
      return { protocolVersion, seq, type, requestId, bookId: bookId(), sessionId: sessionId() };
    case "session_renamed":
      return {
        protocolVersion,
        seq,
        type,
        requestId,
        bookId: bookId(),
        sessionId: sessionId(),
        title: requiredString(input.title, "title", MAX_SESSION_TITLE_LENGTH),
      };
    case "session_switched":
      return {
        protocolVersion,
        seq,
        type,
        requestId,
        bookId: bookId(),
        sessionId: sessionId(),
        messages: decodeMessages(input.messages),
      };
    case "session_rewound":
      return {
        protocolVersion,
        seq,
        type,
        requestId,
        ...correlation(),
        messages: decodeMessages(input.messages),
      };
    case "sessions_list":
      return { protocolVersion, seq, type, requestId, bookId: bookId(), sessions: decodeSessions(input.sessions) };
    case "error":
      if (typeof input.recoverable !== "boolean") throw new ProtocolDecodeError("Invalid recoverable");
      return {
        protocolVersion,
        seq,
        type,
        requestId,
        bookId: optionalString(input.bookId, "bookId"),
        sessionId: optionalString(input.sessionId, "sessionId"),
        promptId: optionalString(input.promptId, "promptId"),
        scope: requiredString(input.scope, "scope", 128),
        message: requiredString(input.message, "message", 4096),
        recoverable: input.recoverable,
      };
    default:
      throw new ProtocolDecodeError(`Unknown event type: ${type}`);
  }
}

export function parseCommandLine(line: string): SidecarCommand {
  if (Buffer.byteLength(line, "utf8") > MAX_JSONL_BYTES) {
    throw new ProtocolDecodeError("Command exceeds JSONL size limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ProtocolDecodeError("Invalid JSON input");
  }
  return decodeCommand(value);
}

export function encodeEvent(event: SidecarEvent): string {
  const line = JSON.stringify(event);
  if (Buffer.byteLength(line, "utf8") > MAX_JSONL_BYTES) {
    throw new ProtocolDecodeError("Event exceeds JSONL size limit");
  }
  return `${line}\n`;
}
