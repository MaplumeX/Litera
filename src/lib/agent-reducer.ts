import type {
  ActiveStepRevisionTarget,
  AgentError,
  AgentEvent,
  AgentMessage,
  AgentSessionSummary,
  AgentStatus,
  AnchorBranchInfo,
  AssistantBlock,
  AssistantChatMessage,
  SideThreadSnapshot,
  StepRevisionEntry,
  StepRevisionSnapshot,
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
  /**
   * Context maintenance in progress (`recovering`: after a request overflowed,
   * before the retry), or the last one failed (cleared by the next prompt).
   */
  compaction: { status: "compacting" | "recovering" | "failed" } | null;
  sessionListRequestId: string | null;
  /** Branch navigation per visible-message anchorId (empty when no forks). */
  branchNavigation: Record<string, AnchorBranchInfo>;
  /** Anchor entry ids, index-aligned with `messages` (visibleMessageEntries). */
  branchAnchors: string[];
  /** Chapter-scoped side-thread transcripts & branch navigation, keyed by `anchorId ?? "__root__"`. */
  sideThreads: Record<string, SideThreadSnapshot>;
  /** Side-thread key targeted by the active in-flight prompt, or null for spine/ordinary prompts. */
  activeSideThreadKey: string | null;
  /** Off-spine step revisions keyed by spine step assistant anchor entry id. */
  stepRevisions: Record<string, StepRevisionSnapshot>;
  /** Active in-flight step revision target, or null when not revising a step. */
  activeRevisionTarget: ActiveStepRevisionTarget | null;
  /** True while the trailing user message was optimistically appended before `prompt_started` persisted it. */
  optimisticUserMessage?: boolean;
}

export type AgentAction =
  | { type: "book_changed"; bookId: string | null }
  | { type: "event"; event: AgentEvent }
  | { type: "session_list_requested"; requestId: string }
  | { type: "prompt_queued"; bookId: string; promptId: string; sideThreadKey?: string; stepRevisionTarget?: ActiveStepRevisionTarget }
  | { type: "prompt_queue_failed"; promptId: string; message: string }
  | { type: "user_message"; message: AgentMessage; sideThreadKey?: string }
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
    compaction: null,
    sessionListRequestId: null,
    branchNavigation: {},
    branchAnchors: [],
    sideThreads: {},
    activeSideThreadKey: null,
    stepRevisions: {},
    activeRevisionTarget: null,
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

function matchesSession(state: AgentState, event: { bookId: string; sessionId: string }): boolean {
  return state.activeBookId === event.bookId && state.sessionId === event.sessionId;
}

function textContent(blocks: AssistantBlock[]): string {
  return blocks
    .filter((block): block is Extract<AssistantBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function appendDelta(
  blocks: AssistantBlock[] | undefined,
  type: "thinking" | "text",
  delta: string,
): AssistantBlock[] {
  const next = blocks ? blocks.slice() : [];
  const last = next[next.length - 1];
  if (last?.type === type) {
    next[next.length - 1] = { type, text: last.text + delta };
  } else {
    next.push({ type, text: delta });
  }
  return next;
}

function withBlocks(
  message: AssistantChatMessage,
  blocks: AssistantBlock[],
): AssistantChatMessage {
  return { ...message, blocks, content: textContent(blocks) };
}

function updateLastAssistant(
  messages: AgentMessage[],
  update: (message: AssistantChatMessage) => AssistantChatMessage,
): AgentMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return [...messages.slice(0, -1), update(last)];
  }
  return [...messages, update({ role: "assistant", content: "", blocks: [] })];
}

function updateSideThreadMessages(
  sideThreads: Record<string, SideThreadSnapshot>,
  key: string,
  updater: (messages: AgentMessage[]) => AgentMessage[],
): Record<string, SideThreadSnapshot> {
  const existing = sideThreads[key] ?? { messages: [], anchors: [], navigation: {} };
  return {
    ...sideThreads,
    [key]: { ...existing, messages: updater(existing.messages) },
  };
}

function updateStepRevisionEntry(
  stepRevisions: Record<string, StepRevisionSnapshot>,
  target: ActiveStepRevisionTarget,
  updater: (entry: StepRevisionEntry) => StepRevisionEntry,
): Record<string, StepRevisionSnapshot> {
  const existing = stepRevisions[target.targetAnchorId] ?? {
    targetAnchorId: target.targetAnchorId,
    revisions: [],
    activeRevisionId: target.revisionId,
  };
  const idx = existing.revisions.findIndex((item) => item.revisionId === target.revisionId);
  const current: StepRevisionEntry =
    idx >= 0
      ? existing.revisions[idx]
      : {
          revisionId: target.revisionId,
          timestamp: new Date().toISOString(),
          ...(target.pace ? { pace: target.pace } : {}),
          ...(target.styleOverride ? { styleOverride: target.styleOverride } : {}),
          ...(target.modelId ? { modelId: target.modelId } : {}),
          content: "",
          blocks: [],
        };
  const updated = updater(current);
  const revisions =
    idx >= 0
      ? [...existing.revisions.slice(0, idx), updated, ...existing.revisions.slice(idx + 1)]
      : [...existing.revisions, updated];
  return {
    ...stepRevisions,
    [target.targetAnchorId]: {
      ...existing,
      revisions,
      activeRevisionId: target.revisionId,
    },
  };
}

function dropPendingRevisionEntry(
  stepRevisions: Record<string, StepRevisionSnapshot>,
  target: ActiveStepRevisionTarget,
): Record<string, StepRevisionSnapshot> {
  const existing = stepRevisions[target.targetAnchorId];
  if (!existing) return stepRevisions;
  const remaining = existing.revisions.filter((item) => item.revisionId !== target.revisionId);
  if (remaining.length === existing.revisions.length) return stepRevisions;
  if (remaining.length === 0) {
    const next = { ...stepRevisions };
    delete next[target.targetAnchorId];
    return next;
  }
  return {
    ...stepRevisions,
    [target.targetAnchorId]: {
      ...existing,
      revisions: remaining,
      activeRevisionId:
        existing.activeRevisionId === target.revisionId
          ? remaining[remaining.length - 1].revisionId
          : existing.activeRevisionId,
    },
  };
}

function applyNavigation(
  base: AgentState,
  event: {
    anchors?: string[];
    navigation?: Record<string, AnchorBranchInfo>;
    sideThreads?: Record<string, SideThreadSnapshot>;
    stepRevisions?: Record<string, StepRevisionSnapshot>;
  },
): AgentState {
  return {
    ...base,
    branchAnchors: event.anchors ?? [],
    branchNavigation: event.navigation ?? {},
    ...(event.sideThreads !== undefined ? { sideThreads: event.sideThreads } : {}),
    ...(event.stepRevisions !== undefined ? { stepRevisions: event.stepRevisions } : {}),
  };
}

/**
 * A transcript marker written in the background (a compaction notice or a
 * chapter recap) landed at the persisted leaf. Without a prompt the
 * projection replaces the transcript. During one, the transcript also holds
 * the optimistic question and streamed state the projection lacks; the
 * marker is the projection's last item, so insert it at that position and
 * keep the in-flight tail after it.
 */
function withLandedMarker(
  base: AgentState,
  event: { messages: AgentMessage[]; anchors: string[]; navigation: Record<string, AnchorBranchInfo> },
  role: "notice" | "recap" | "guide_cut",
): AgentState {
  if (!base.promptId) return applyNavigation({ ...base, messages: event.messages }, event);
  const markerIndex = event.messages.length - 1;
  const marker = event.messages[markerIndex];
  if (marker?.role !== role || base.messages.length < markerIndex) return base;
  return applyNavigation({
    ...base,
    messages: [...base.messages.slice(0, markerIndex), marker, ...base.messages.slice(markerIndex)],
  }, event);
}

function applyEvent(state: AgentState, event: AgentEvent): AgentState {
  if (event.version <= state.version) return state;
  const base = { ...state, version: event.version };

  switch (event.type) {
    case "book_loading":
      return matchesBook(base, event.bookId)
        ? { ...base, status: "loadingBook", sessionId: null, promptId: null, messages: [], sessions: [], error: null, compaction: null, branchNavigation: {}, branchAnchors: [], sideThreads: {}, activeSideThreadKey: null, stepRevisions: {}, activeRevisionTarget: null, optimisticUserMessage: false }
        : base;
    case "book_ready":
      return matchesBook(base, event.bookId) ? { ...base, status: "bookReady", error: null } : base;
    case "book_closed":
      return matchesBook(base, event.bookId)
        ? { ...base, status: "idle", sessionId: null, promptId: null, messages: [], sessions: [], error: null, compaction: null, branchNavigation: {}, branchAnchors: [], sideThreads: {}, activeSideThreadKey: null, stepRevisions: {}, activeRevisionTarget: null, optimisticUserMessage: false }
        : base;
    case "prompt_started":
      return matchesBook(base, event.bookId)
        ? {
            ...base,
            status: "prompting",
            sessionId: event.sessionId,
            promptId: event.promptId,
            activeSideThreadKey: event.sideThreadKey ?? null,
            activeRevisionTarget: event.stepRevisionTarget ?? null,
            stepRevisions: event.stepRevisionTarget
              ? updateStepRevisionEntry(base.stepRevisions, event.stepRevisionTarget, (entry) => entry)
              : base.stepRevisions,
            error: null,
            compaction: null,
            optimisticUserMessage: false,
          }
        : base;
    case "text_delta":
      if (!matchesPrompt(base, event)) return base;
      if (event.stepRevisionTarget) {
        return {
          ...base,
          stepRevisions: updateStepRevisionEntry(base.stepRevisions, event.stepRevisionTarget, (entry) => {
            const blocks = appendDelta(entry.blocks, "text", event.delta);
            return { ...entry, blocks, content: textContent(blocks) };
          }),
        };
      }
      if (event.sideThreadKey) {
        return {
          ...base,
          sideThreads: updateSideThreadMessages(base.sideThreads, event.sideThreadKey, (messages) =>
            updateLastAssistant(messages, (message) =>
              withBlocks(message, appendDelta(message.blocks, "text", event.delta)))),
        };
      }
      return {
        ...base,
        messages: updateLastAssistant(base.messages, (message) =>
          withBlocks(message, appendDelta(message.blocks, "text", event.delta))),
      };
    case "thinking_start":
    case "thinking_end":
      return base;
    case "thinking_delta":
      if (!matchesPrompt(base, event)) return base;
      if (event.stepRevisionTarget) {
        return {
          ...base,
          stepRevisions: updateStepRevisionEntry(base.stepRevisions, event.stepRevisionTarget, (entry) => {
            const blocks = appendDelta(entry.blocks, "thinking", event.delta);
            return { ...entry, blocks, content: textContent(blocks) };
          }),
        };
      }
      if (event.sideThreadKey) {
        return {
          ...base,
          sideThreads: updateSideThreadMessages(base.sideThreads, event.sideThreadKey, (messages) =>
            updateLastAssistant(messages, (message) =>
              withBlocks(message, appendDelta(message.blocks, "thinking", event.delta)))),
        };
      }
      return {
        ...base,
        messages: updateLastAssistant(base.messages, (message) =>
          withBlocks(message, appendDelta(message.blocks, "thinking", event.delta))),
      };
    case "tool_start":
      if (!matchesPrompt(base, event)) return base;
      {
        if (event.stepRevisionTarget) {
          return {
            ...base,
            stepRevisions: updateStepRevisionEntry(base.stepRevisions, event.stepRevisionTarget, (entry) => {
              const blocks = entry.blocks ? entry.blocks.slice() : [];
              blocks.push({
                type: "toolCall",
                toolCall: {
                  toolCallId: event.toolCallId,
                  tool: event.tool,
                  params: event.params,
                  done: false,
                },
              });
              return { ...entry, blocks, content: textContent(blocks) };
            }),
          };
        }
        const applyToolStart = (messages: AgentMessage[]) =>
          updateLastAssistant(messages, (message) => {
            const blocks = message.blocks ? message.blocks.slice() : [];
            blocks.push({
              type: "toolCall",
              toolCall: {
                toolCallId: event.toolCallId,
                tool: event.tool,
                params: event.params,
                done: false,
              },
            });
            return withBlocks(message, blocks);
          });
        if (event.sideThreadKey) {
          return { ...base, sideThreads: updateSideThreadMessages(base.sideThreads, event.sideThreadKey, applyToolStart) };
        }
        return { ...base, messages: applyToolStart(base.messages) };
      }
    case "tool_end":
      if (!matchesPrompt(base, event)) return base;
      {
        if (event.stepRevisionTarget) {
          return {
            ...base,
            stepRevisions: updateStepRevisionEntry(base.stepRevisions, event.stepRevisionTarget, (entry) => {
              const blocks = entry.blocks?.map((block) =>
                block.type === "toolCall" && block.toolCall.toolCallId === event.toolCallId
                  ? {
                      type: "toolCall" as const,
                      toolCall: {
                        ...block.toolCall,
                        result: event.result,
                        done: true,
                        isError: event.isError,
                      },
                    }
                  : block,
              );
              return blocks ? { ...entry, blocks, content: textContent(blocks) } : entry;
            }),
          };
        }
        const applyToolEnd = (messages: AgentMessage[]) =>
          updateLastAssistant(messages, (message) => {
            const blocks = message.blocks?.map((block) =>
              block.type === "toolCall" && block.toolCall.toolCallId === event.toolCallId
                ? {
                    type: "toolCall" as const,
                    toolCall: {
                      ...block.toolCall,
                      result: event.result,
                      done: true,
                      isError: event.isError,
                      ...(event.guide ? { guide: event.guide } : {}),
                    },
                  }
                : block,
            );
            return blocks ? withBlocks(message, blocks) : message;
          });
        if (event.sideThreadKey) {
          return { ...base, sideThreads: updateSideThreadMessages(base.sideThreads, event.sideThreadKey, applyToolEnd) };
        }
        return { ...base, messages: applyToolEnd(base.messages) };
      }
    case "compaction_started":
      return matchesSession(base, event)
        ? { ...base, compaction: { status: event.reason === "overflow" ? "recovering" : "compacting" } }
        : base;
    case "compaction_completed":
      return matchesSession(base, event) ? withLandedMarker({ ...base, compaction: null }, event, "notice") : base;
    case "guide_recap_added":
      return matchesSession(base, event) ? withLandedMarker(base, event, "recap") : base;
    case "guide_window_updated":
      return matchesSession(base, event) ? applyNavigation({ ...base, messages: event.messages }, event) : base;
    case "session_archived":
      if (!matchesBook(base, event.bookId)) return base;
      return {
        ...base,
        sessions: base.sessions.map((session) =>
          session.id === event.sessionId ? { ...session, archived: true } : session),
      };
    case "session_unarchived":
      if (!matchesBook(base, event.bookId)) return base;
      return {
        ...base,
        sessions: base.sessions.map((session) => {
          if (session.id !== event.sessionId) return session;
          const { archived: _removed, ...rest } = session;
          return { ...rest, updatedAt: new Date().toISOString() };
        }),
      };
    case "compaction_failed":
      return matchesSession(base, event) ? { ...base, compaction: event.aborted ? null : { status: "failed" } } : base;
    case "retry_scheduled":
      // The retry restarts the whole turn: drop the failed attempt's streamed
      // bubble so the next attempt does not append onto it.
      if (!matchesPrompt(base, event)) return base;
      if (event.stepRevisionTarget) {
        return {
          ...base,
          stepRevisions: updateStepRevisionEntry(base.stepRevisions, event.stepRevisionTarget, (entry) => ({
            ...entry,
            content: "",
            blocks: [],
          })),
        };
      }
      if (event.sideThreadKey) {
        const list = base.sideThreads[event.sideThreadKey]?.messages;
        if (!list || list[list.length - 1]?.role !== "assistant") return base;
        return {
          ...base,
          sideThreads: updateSideThreadMessages(base.sideThreads, event.sideThreadKey, (messages) => messages.slice(0, -1)),
        };
      }
      if (base.messages[base.messages.length - 1]?.role !== "assistant") return base;
      return { ...base, messages: base.messages.slice(0, -1) };
    case "prompt_end":
    case "prompt_aborted":
      if (!matchesPrompt(base, event)) return base;
      {
        // A compaction during the prompt shows up as a notice item in the
        // projection, so the pending state is cleared.
        const next = {
          ...base,
          status: "bookReady" as const,
          promptId: null,
          activeSideThreadKey: null,
          activeRevisionTarget: null,
          compaction: null,
          optimisticUserMessage: false,
        };
        // Streaming deltas already maintained messages; the runtime's full
        // projection replaces them (equal content) and refreshes navigation.
        if (event.messages !== undefined) next.messages = event.messages;
        return applyNavigation(next, event);
      }
    case "session_created":
      return matchesBook(base, event.bookId)
        ? {
            ...base,
            sessionId: event.sessionId,
            messages: base.promptId ? base.messages : [],
            branchNavigation: base.promptId ? base.branchNavigation : {},
            branchAnchors: base.promptId ? base.branchAnchors : [],
            sideThreads: base.promptId ? base.sideThreads : {},
            activeSideThreadKey: base.promptId ? base.activeSideThreadKey : null,
            stepRevisions: base.promptId ? base.stepRevisions : {},
            activeRevisionTarget: base.promptId ? base.activeRevisionTarget : null,
            error: null,
            sessions: upsertSession(base.sessions, {
              id: event.sessionId,
              title: t("chat.newSessionTitle"),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              ...(event.kind ? { kind: event.kind } : {}),
            }),
          }
        : base;
    case "session_switched":
      return matchesBook(base, event.bookId)
        ? applyNavigation({ ...base, sessionId: event.sessionId, promptId: null, activeSideThreadKey: null, activeRevisionTarget: null, messages: event.messages, sideThreads: event.sideThreads ?? {}, stepRevisions: event.stepRevisions ?? {}, status: "bookReady", error: null, compaction: null, optimisticUserMessage: false }, event)
        : base;
    case "branch_switched":
      if (!matchesBook(base, event.bookId)) return base;
      if (base.sessionId !== null && base.sessionId !== event.sessionId) return base;
      return {
        ...base,
        sessionId: event.sessionId,
        messages: event.messages,
        error: null,
        compaction: null,
        branchNavigation: event.navigation,
        branchAnchors: event.anchors,
        sideThreads: event.sideThreads ?? base.sideThreads,
        stepRevisions: event.stepRevisions ?? base.stepRevisions,
        optimisticUserMessage: false,
      };
    case "step_revision_selected":
      if (!matchesBook(base, event.bookId)) return base;
      if (base.sessionId !== null && base.sessionId !== event.sessionId) return base;
      return {
        ...base,
        sessionId: event.sessionId,
        error: null,
        sideThreads: event.sideThreads ?? base.sideThreads,
        stepRevisions: event.stepRevisions ?? base.stepRevisions,
      };
    case "session_rewound":
      if (!matchesBook(base, event.bookId)) return base;
      if (event.sideThreadKey) {
        return {
          ...base,
          sessionId: event.sessionId,
          sideThreads: updateSideThreadMessages(base.sideThreads, event.sideThreadKey, () => event.messages),
          error: null,
          compaction: null,
          optimisticUserMessage: false,
        };
      }
      return { ...base, sessionId: event.sessionId, messages: event.messages, error: null, compaction: null, optimisticUserMessage: false };
    case "session_deleted":
      if (!matchesBook(base, event.bookId)) return base;
      return {
        ...base,
        sessionId: base.sessionId === event.sessionId ? null : base.sessionId,
        messages: base.sessionId === event.sessionId ? [] : base.messages,
        branchNavigation: base.sessionId === event.sessionId ? {} : base.branchNavigation,
        branchAnchors: base.sessionId === event.sessionId ? [] : base.branchAnchors,
        sideThreads: base.sessionId === event.sessionId ? {} : base.sideThreads,
        activeSideThreadKey: base.sessionId === event.sessionId ? null : base.activeSideThreadKey,
        stepRevisions: base.sessionId === event.sessionId ? {} : base.stepRevisions,
        activeRevisionTarget: base.sessionId === event.sessionId ? null : base.activeRevisionTarget,
        optimisticUserMessage: base.sessionId === event.sessionId ? false : base.optimisticUserMessage,
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
      const revTarget = event.stepRevisionTarget ?? base.activeRevisionTarget;
      const sideKey = event.sideThreadKey ?? base.activeSideThreadKey;
      const sideMsgs = sideKey ? base.sideThreads[sideKey]?.messages : undefined;
      const rollbackSide = matchesActivePrompt
        && base.optimisticUserMessage
        && !!sideKey
        && !!sideMsgs
        && sideMsgs[sideMsgs.length - 1]?.role === "user";
      const rollbackOptimistic = matchesActivePrompt
        && base.optimisticUserMessage
        && !sideKey
        && !revTarget
        && base.messages[base.messages.length - 1]?.role === "user";
      return {
        ...base,
        messages: rollbackOptimistic ? base.messages.slice(0, -1) : base.messages,
        sideThreads: rollbackSide && sideKey
          ? updateSideThreadMessages(base.sideThreads, sideKey, (messages) => messages.slice(0, -1))
          : base.sideThreads,
        stepRevisions: matchesActivePrompt && revTarget
          ? dropPendingRevisionEntry(base.stepRevisions, revTarget)
          : base.stepRevisions,
        status: matchesActivePrompt ? "bookReady" : event.scope === "book" ? "error" : base.status,
        promptId: matchesActivePrompt ? null : base.promptId,
        activeSideThreadKey: matchesActivePrompt ? null : base.activeSideThreadKey,
        activeRevisionTarget: matchesActivePrompt ? null : base.activeRevisionTarget,
        compaction: matchesActivePrompt ? null : base.compaction,
        optimisticUserMessage: matchesActivePrompt ? false : base.optimisticUserMessage,
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
      return {
        ...state,
        status: "prompting",
        promptId: action.promptId,
        activeSideThreadKey: action.sideThreadKey ?? null,
        activeRevisionTarget: action.stepRevisionTarget ?? null,
        stepRevisions: action.stepRevisionTarget
          ? updateStepRevisionEntry(state.stepRevisions, action.stepRevisionTarget, (entry) => entry)
          : state.stepRevisions,
        error: null,
        compaction: state.compaction?.status === "failed" ? null : state.compaction,
        optimisticUserMessage: false,
      };
    case "prompt_queue_failed": {
      if (state.promptId !== action.promptId) return state;
      const revTarget = state.activeRevisionTarget;
      const sideKey = state.activeSideThreadKey;
      const sideMsgs = sideKey ? state.sideThreads[sideKey]?.messages : undefined;
      const rollbackSide =
        state.optimisticUserMessage && !!sideKey && !!sideMsgs && sideMsgs[sideMsgs.length - 1]?.role === "user";
      const rollbackOptimistic =
        state.optimisticUserMessage && !sideKey && !revTarget && state.messages[state.messages.length - 1]?.role === "user";
      return {
        ...state,
        messages: rollbackOptimistic ? state.messages.slice(0, -1) : state.messages,
        sideThreads: rollbackSide && sideKey
          ? updateSideThreadMessages(state.sideThreads, sideKey, (messages) => messages.slice(0, -1))
          : state.sideThreads,
        stepRevisions: revTarget
          ? dropPendingRevisionEntry(state.stepRevisions, revTarget)
          : state.stepRevisions,
        status: state.activeBookId ? "bookReady" : "idle",
        promptId: null,
        activeSideThreadKey: null,
        activeRevisionTarget: null,
        optimisticUserMessage: false,
        error: {
          scope: "prompt",
          message: action.message,
          recoverable: true,
          bookId: state.activeBookId ?? undefined,
          promptId: action.promptId,
        },
      };
    }
    case "user_message":
      if (action.sideThreadKey) {
        return {
          ...state,
          sideThreads: updateSideThreadMessages(state.sideThreads, action.sideThreadKey, (messages) => [
            ...messages,
            action.message,
          ]),
          error: null,
          optimisticUserMessage: state.promptId !== null,
        };
      }
      return {
        ...state,
        messages: [...state.messages, action.message],
        error: null,
        optimisticUserMessage: state.promptId !== null,
      };
    case "clear_error":
      return { ...state, error: null };
  }
}
