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

/** A Guided session reads the Book to the reader; fixed at creation. */
export type SessionKind = "guided";

/** A block (Markdown paragraph) of a chapter, as a guided step's range names it. */
export interface GuidePosition {
  chapterIndex: number;
  chapterTitle?: string;
  /** 0-based block of the chapter (see `BookTocEntry.blocks`). */
  block: number;
  /** The block's opening text when the step was sent, to find it again if the blocks shift. */
  snippet?: string;
  /**
   * The 1-based paragraph (see `isGuideParagraph`) the reader sees at this end
   * of a range: as `from`, the first at or after `block`; as `to`, the last
   * at or before it. Absent on steps recorded before it was kept.
   */
  paragraph?: number;
}

/** A reader's selection to guide up to. */
export interface GuideSelection {
  text: string;
  /** The text of the page's paragraph the selection ends in. */
  paragraph?: string;
  chapterHref?: string;
}

/**
 * One guided step, taken by the assistant with `guide_step` and persisted as
 * `guide` on that tool result's entry (on the user message entry in Sessions
 * recorded before); the latest one on the active branch is the Guide cursor.
 * Without `range` it covers part `part` of the chapter (a
 * skim: `part` to the chapter's end). With `range` it covers exactly the
 * blocks `from` to `to`, possibly across chapters, and `chapterIndex` /
 * `part` name the part `from` is in.
 */
export interface GuideStep {
  chapterIndex: number;
  /** 0-based read_chapter part. */
  part: number;
  totalParts: number;
  chapterTitle?: string;
  /** A compressed pass instead of a full retelling. */
  skim?: true;
  /** The blocks covered, `to` inclusive. */
  range?: { from: GuidePosition; to: GuidePosition };
}

/**
 * What a reader's message in a Guided session asks of the guide: Continue
 * (no `step`; the assistant picks where the step ends) or a step the reader
 * picked. It is not a step itself; the assistant takes it with `guide_step`.
 */
export interface GuideRequest {
  step?: GuideStep;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  systemPrompt?: string;
  kind?: SessionKind;
  /** Guided sessions: the guide cursor, absent before the first step. */
  guide?: GuideStep;
}

export interface BranchOption {
  /** The first user-message entry id of this sibling branch. */
  anchorId: string;
  /** Preview text of that first user message (truncated). */
  preview: string;
}

export interface AnchorBranchInfo {
  /** Sibling branches, ordered by first-user-message timestamp ascending. */
  options: BranchOption[];
  /** Index of the branch the current leafId is on; -1 when undetermined. */
  activeIndex: number;
}

export interface AgentToolCall {
  toolCallId: string;
  tool: string;
  params: unknown;
  result?: unknown;
  done: boolean;
  isError?: boolean;
  /** The guided step a `guide_step` call took. */
  guide?: GuideStep;
}

export type AssistantBlock =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "toolCall"; toolCall: AgentToolCall };

export interface UserMessage {
  role: "user";
  content: string;
  selection?: string;
  chapterHref?: string;
  /** A guided step sent as the user message, in Sessions recorded before the assistant took steps itself. */
  guide?: GuideStep;
  /** Continue or a picked step; the content is then its label. */
  guideRequest?: GuideRequest;
}

export interface AssistantChatMessage {
  role: "assistant";
  content: string;
  blocks?: AssistantBlock[];
  /** Terminal state of the persisted assistant message (UI only cares about non-normal endings). */
  stopReason?: "aborted" | "error";
  /** Preset, credential-free failure reason when `stopReason` is "error". */
  errorMessage?: string;
}

/**
 * Inline transcript marker for a context compaction. Rendered where the
 * compaction entry sits on the durable branch, carrying the summary the model
 * now sees in place of the compacted messages.
 */
export interface CompactionNotice {
  role: "notice";
  summary: string;
  tokensBefore: number;
}

/**
 * Inline transcript marker for a chapter recap in a Guided session, where the
 * recap entry sits on the branch: what the model keeps of a finished chapter.
 */
export interface GuideRecapMarker {
  role: "recap";
  chapterIndex: number;
  chapterTitle?: string;
  /** The last chapter of a recap that covers several, finished by one step. */
  throughChapterIndex?: number;
  throughChapterTitle?: string;
  text: string;
}

/**
 * One visible item in the transcript, index-aligned with `branchAnchors`.
 * `notice` and `recap` items are transcript markers, not chat turns.
 */
export type AgentMessage = UserMessage | AssistantChatMessage | CompactionNotice | GuideRecapMarker;

/** Transcript markers are not chat turns. */
export function isTranscriptMarker(message: AgentMessage): message is CompactionNotice | GuideRecapMarker {
  return message.role === "notice" || message.role === "recap";
}

/** The guided steps taken in a transcript, oldest first: by `guide_step` calls, or sent as user messages in older Sessions. */
export function takenGuideSteps(messages: readonly AgentMessage[]): GuideStep[] {
  return messages.flatMap((message) => {
    if (message.role === "user") return message.guide ? [message.guide] : [];
    if (message.role !== "assistant") return [];
    return (message.blocks ?? []).flatMap((block) => (block.type === "toolCall" && block.toolCall.guide ? [block.toolCall.guide] : []));
  });
}

type EventEnvelope = {
  version: number;
};

type RequestCorrelation = { requestId?: string };
type BookCorrelation = { bookId: string };
type SessionCorrelation = BookCorrelation & { sessionId: string };
type PromptCorrelation = SessionCorrelation & { promptId: string };

export type AgentEvent = EventEnvelope & (
  | ({ type: "book_loading" } & BookCorrelation & RequestCorrelation)
  | ({ type: "book_ready" } & BookCorrelation & RequestCorrelation)
  | ({ type: "book_closed"; bookId?: string } & RequestCorrelation)
  | ({ type: "prompt_started" } & PromptCorrelation & RequestCorrelation)
  | ({ type: "text_delta"; delta: string } & PromptCorrelation)
  | ({ type: "thinking_start"; contentIndex: number } & PromptCorrelation)
  | ({ type: "thinking_delta"; delta: string; contentIndex: number } & PromptCorrelation)
  | ({ type: "thinking_end"; contentIndex: number } & PromptCorrelation)
  | ({ type: "tool_start"; toolCallId: string; tool: string; params: unknown } & PromptCorrelation)
  /** `guide`: the step a `guide_step` call took. */
  | ({ type: "tool_end"; toolCallId: string; result: unknown; isError: boolean; guide?: GuideStep } & PromptCorrelation)
  // Context maintenance runs inside a prompt or in the background after one,
  // so compaction events correlate to the Session, not to a prompt.
  // `reason: "overflow"`: a request exceeded the context window and is retried after compaction.
  | ({ type: "compaction_started"; reason: "budget" | "overflow" } & SessionCorrelation)
  | ({ type: "compaction_completed"; messages: AgentMessage[]; anchors: string[]; navigation: Record<string, AnchorBranchInfo> } & SessionCorrelation)
  | ({ type: "compaction_failed"; aborted: boolean } & SessionCorrelation)
  // A chapter recap was written after a guided turn, in the same background
  // task as context maintenance.
  | ({ type: "guide_recap_added"; messages: AgentMessage[]; anchors: string[]; navigation: Record<string, AnchorBranchInfo> } & SessionCorrelation)
  | ({ type: "retry_scheduled"; attempt: number; maxAttempts: number; delayMs: number } & PromptCorrelation)
  | ({ type: "prompt_end"; messages?: AgentMessage[]; anchors?: string[]; navigation?: Record<string, AnchorBranchInfo>} & PromptCorrelation)
  | ({ type: "prompt_aborted"; messages?: AgentMessage[]; anchors?: string[]; navigation?: Record<string, AnchorBranchInfo> } & PromptCorrelation & RequestCorrelation)
  | ({ type: "session_created"; kind?: SessionKind } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_switched"; messages: AgentMessage[]; anchors?: string[]; navigation?: Record<string, AnchorBranchInfo> } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "branch_switched"; messages: AgentMessage[]; anchors: string[]; navigation: Record<string, AnchorBranchInfo> } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_rewound"; messages: AgentMessage[] } & PromptCorrelation & RequestCorrelation)
  | ({ type: "session_deleted" } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_renamed"; title: string } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "session_config_updated"; systemPrompt?: string } & BookCorrelation & { sessionId: string } & RequestCorrelation)
  | ({ type: "sessions_list"; sessions: AgentSessionSummary[] } & BookCorrelation & RequestCorrelation)
  | ({ type: "error" } & AgentError)
);
