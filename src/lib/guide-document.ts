import { guideStepLabel, positionTitle } from "@/components/chat/GuideBar";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import { ROOT_SIDE_THREAD_KEY } from "@/agent/sessions/pi-session";
import type {
  AgentMessage,
  AnchorBranchInfo,
  AssistantBlock,
  CompactionNotice,
  GuideContextCutMarker,
  RecordedGuideStep,
  SideThreadSnapshot,
} from "@/types/agent";

export interface GuideSideQaNode {
  id: string;
  /** Unique numeric scroll/outline index across the GuideDocument (spine index for legacy inline QAs, synthetic index for side-thread QAs). */
  userMessageIndex: number;
  assistantMessageIndex?: number;
  /** Side-thread map key (`anchorEntryId` or `"__root__"`) for off-spine Q&As; absent for legacy inline Q&As. */
  sideThreadKey?: string;
  /** 0-based user message index inside `sideThreads[sideThreadKey].messages`. */
  sideMessageIndex?: number;
  /** 0-based assistant message index inside `sideThreads[sideThreadKey].messages`. */
  sideAssistantMessageIndex?: number;
  question: string;
  selection?: string;
  chapterHref?: string;
  answer: string;
  blocks?: AssistantBlock[];
  streaming: boolean;
  stopReason?: "aborted" | "error";
  errorMessage?: string;
  branchAnchorId?: string;
  branchInfo?: AnchorBranchInfo;
  assistantBranchAnchorId?: string;
  assistantBranchInfo?: AnchorBranchInfo;
}

export interface GuideStepNode {
  /** 0-based index aligned with `takenGuideSteps(messages)` and `data-litera-guide-step`. */
  stepIndex: number;
  id: string;
  step: RecordedGuideStep;
  label: string;
  chapterIndex: number;
  chapterTitle: string;
  endChapterIndex: number;
  /** Visible message index in `messages` (used for scroll / regenerate / PageGuideCard). */
  messageIndex: number;
  /** The user message index that triggered this step, when present. */
  requestMessageIndex?: number;
  /** Non-mechanical user prompt text if the user asked in natural language (e.g. "带读第3章"). */
  requestText?: string;
  toolCallId?: string;
  explanation: string;
  blocks?: AssistantBlock[];
  streaming: boolean;
  stopReason?: "aborted" | "error";
  errorMessage?: string;
  branchAnchorId?: string;
  branchInfo?: AnchorBranchInfo;
  sideThreads: GuideSideQaNode[];
}

export interface GuidePendingStepNode {
  id: string;
  messageIndex: number;
  requestMessageIndex?: number;
  toolCallId: string;
}

export type GuideIncompleteStepStatus = "streaming" | "aborted" | "error" | "replied";

/**
 * A guided step request that has not committed a `Guided step` (aborted,
 * errored, pre-tool streaming, or replied without calling `guide_step`).
 * Kept off `sideThreads` so it never pollutes follow-up Q&A lists or exports.
 */
export interface GuideIncompleteStepNode {
  id: string;
  /** Timeline anchor: null before the first committed step, otherwise after this stepIndex. */
  afterStepIndex: number | null;
  requestMessageIndex: number;
  assistantMessageIndex?: number;
  label: string;
  isGuideRequest: boolean;
  status: GuideIncompleteStepStatus;
  content: string;
  blocks?: AssistantBlock[];
  streaming: boolean;
  stopReason?: "aborted" | "error";
  errorMessage?: string;
  branchAnchorId?: string;
  branchInfo?: AnchorBranchInfo;
  assistantBranchAnchorId?: string;
  assistantBranchInfo?: AnchorBranchInfo;
}

export type GuideTimelineMarker =
  | {
      kind: "guide_cut";
      messageIndex: number;
      afterStepIndex: number | null;
      marker: GuideContextCutMarker;
    }
  | {
      kind: "compaction";
      messageIndex: number;
      afterStepIndex: number | null;
      notice: CompactionNotice;
    };

/** Chronological run of consecutive steps starting in the same chapter (for GuideWorkspace). */
export interface GuideChapterRun {
  id: string;
  /** Stable spine entry id of this run's first step (used to anchor chapter side-threads). */
  anchorEntryId: string | null;
  chapterIndex: number;
  chapterTitle: string;
  /** True when an earlier run already covered this chapter (a re-read). */
  isReread: boolean;
  steps: GuideStepNode[];
  /** Chapter-scoped follow-up Q&As (legacy inline Q&As in this run + off-spine side-thread Q&As). */
  sideThreads: GuideSideQaNode[];
}

export type GuideChapterStatus = "unread" | "in_progress" | "completed";

/** Book-TOC chapter summary (for GuideNavRail and Book-wide progress). */
export interface GuideChapterNode {
  chapterIndex: number;
  title: string;
  href?: string;
  status: GuideChapterStatus;
  coveredBlocks: number;
  totalBlocks: number;
  isCurrent: boolean;
  stepIndices: number[];
  questionCount: number;
}

export interface GuideTocInput {
  chapterIndex?: number;
  label: string;
  href: string;
}

export interface GuideDocument {
  bookId: string;
  sessionId: string | null;
  steps: GuideStepNode[];
  pendingSteps: GuidePendingStepNode[];
  incompleteSteps: GuideIncompleteStepNode[];
  runs: GuideChapterRun[];
  chapters: GuideChapterNode[];
  orphanSideThreads: GuideSideQaNode[];
  markers: GuideTimelineMarker[];
  hasStarted: boolean;
  /** Total side Q&A turns across all steps and orphan threads. */
  totalQuestions: number;
}

export interface ProjectGuideDocumentInput {
  bookId: string;
  sessionId: string | null;
  messages: readonly AgentMessage[];
  branchAnchors?: readonly string[];
  branchNavigation?: Readonly<Record<string, AnchorBranchInfo>>;
  /** Chapter-scoped off-spine side-thread snapshots keyed by `anchorEntryId ?? "__root__"`. */
  sideThreads?: Readonly<Record<string, SideThreadSnapshot>>;
  /** Side-thread key currently streaming an answer, or null for spine streaming. */
  activeSideThreadKey?: string | null;
  isStreaming?: boolean;
  toc?: readonly GuideTocInput[];
  tocProgress?: Readonly<Record<string, GuideChapterProgress>>;
}

function stepChapterStart(step: RecordedGuideStep): { chapterIndex: number; chapterTitle: string } {
  const from = "from" in step ? step.from : step;
  return {
    chapterIndex: from.chapterIndex,
    chapterTitle: positionTitle(from),
  };
}

function stepChapterEnd(step: RecordedGuideStep): number {
  return "to" in step ? step.to.chapterIndex : step.chapterIndex;
}

function branchForIndex(
  index: number | undefined,
  anchors: readonly string[] | undefined,
  navigation: Readonly<Record<string, AnchorBranchInfo>> | undefined,
): { branchAnchorId?: string; branchInfo?: AnchorBranchInfo } {
  if (index === undefined || !anchors) return {};
  const anchorId = anchors[index];
  if (!anchorId) return {};
  const info = navigation?.[anchorId];
  return {
    branchAnchorId: anchorId,
    ...(info && info.options.length > 1 && info.activeIndex >= 0 ? { branchInfo: info } : {}),
  };
}

function preferAssistantBranch(
  assistantIndex: number,
  userIndex: number | undefined,
  anchors: readonly string[] | undefined,
  navigation: Readonly<Record<string, AnchorBranchInfo>> | undefined,
): { branchAnchorId?: string; branchInfo?: AnchorBranchInfo } {
  const assistant = branchForIndex(assistantIndex, anchors, navigation);
  if (assistant.branchInfo) return assistant;
  const user = branchForIndex(userIndex, anchors, navigation);
  return user.branchInfo ? user : assistant;
}

function projectSideThreadSnapshot(
  sideThreadKey: string,
  snapshot: SideThreadSnapshot | undefined,
  isStreamingThread: boolean,
  allocateIndex: () => number,
): GuideSideQaNode[] {
  if (!snapshot || snapshot.messages.length === 0) return [];
  const { messages, anchors, navigation } = snapshot;
  const result: GuideSideQaNode[] = [];
  let lastChatIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const role = messages[i].role;
    if (role === "user" || role === "assistant") {
      lastChatIndex = i;
      break;
    }
  }
  let pending: {
    index: number;
    content: string;
    selection?: string;
    chapterHref?: string;
  } | null = null;

  const flushPending = () => {
    if (!pending) return;
    const { branchAnchorId, branchInfo } = branchForIndex(pending.index, anchors, navigation);
    result.push({
      id: `side-${sideThreadKey}-qa-${pending.index}`,
      userMessageIndex: allocateIndex(),
      sideThreadKey,
      sideMessageIndex: pending.index,
      question: pending.content,
      selection: pending.selection,
      chapterHref: pending.chapterHref,
      answer: "",
      streaming: isStreamingThread && pending.index === lastChatIndex,
      branchAnchorId,
      branchInfo,
    });
    pending = null;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "user") {
      flushPending();
      pending = {
        index,
        content: message.content,
        selection: message.selection,
        chapterHref: message.chapterHref,
      };
      continue;
    }
    if (message.role === "assistant" && pending) {
      const streamingThis = isStreamingThread && index === lastChatIndex;
      const { branchAnchorId, branchInfo } = branchForIndex(pending.index, anchors, navigation);
      const assistantBranch = branchForIndex(index, anchors, navigation);
      const userScrollIndex = allocateIndex();
      const assistantScrollIndex = allocateIndex();
      result.push({
        id: `side-${sideThreadKey}-qa-${pending.index}`,
        userMessageIndex: userScrollIndex,
        assistantMessageIndex: assistantScrollIndex,
        sideThreadKey,
        sideMessageIndex: pending.index,
        sideAssistantMessageIndex: index,
        question: pending.content,
        selection: pending.selection,
        chapterHref: pending.chapterHref,
        answer: message.content,
        blocks: message.blocks,
        streaming: streamingThis,
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
        branchAnchorId,
        branchInfo,
        assistantBranchAnchorId: assistantBranch.branchAnchorId,
        assistantBranchInfo: assistantBranch.branchInfo,
      });
      pending = null;
    }
  }
  flushPending();
  return result;
}

/**
 * Pure projection of a Guided session's active branch transcript into a
 * structured `GuideDocument`: chapter-grouped step sections, anchored
 * side-threads, timeline markers, and TOC chapter progress.
 */
export function projectGuideDocument({
  bookId,
  sessionId,
  messages,
  branchAnchors,
  branchNavigation,
  sideThreads,
  activeSideThreadKey = null,
  isStreaming = false,
  toc,
  tocProgress,
}: ProjectGuideDocumentInput): GuideDocument {
  const isSpineStreaming = isStreaming && !activeSideThreadKey;
  const steps: GuideStepNode[] = [];
  const pendingSteps: GuidePendingStepNode[] = [];
  const incompleteSteps: GuideIncompleteStepNode[] = [];
  const orphanSideThreads: GuideSideQaNode[] = [];
  const markers: GuideTimelineMarker[] = [];

  let lastChatIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const role = messages[i].role;
    if (role === "user" || role === "assistant") {
      lastChatIndex = i;
      break;
    }
  }

  let currentStep: GuideStepNode | null = null;
  let pendingUser: {
    index: number;
    content: string;
    selection?: string;
    chapterHref?: string;
    isGuideRequest: boolean;
    guideStep?: RecordedGuideStep;
  } | null = null;

  const incompleteLabel = (user: NonNullable<typeof pendingUser>): string =>
    user.guideStep ? guideStepLabel(user.guideStep) : user.content;

  const flushPendingUser = (atEnd = false) => {
    if (!pendingUser) return;
    if (pendingUser.isGuideRequest) {
      // While streaming before the first assistant event arrives, GuideWorkspace
      // renders TypingIndicator directly; only materialize an unanswered request
      // once it is no longer awaiting a live response.
      if (atEnd && isSpineStreaming && pendingUser.index === lastChatIndex) {
        pendingUser = null;
        return;
      }
      const { branchAnchorId, branchInfo } = branchForIndex(
        pendingUser.index,
        branchAnchors,
        branchNavigation,
      );
      incompleteSteps.push({
        id: `incomplete-${pendingUser.index}`,
        afterStepIndex: currentStep ? currentStep.stepIndex : null,
        requestMessageIndex: pendingUser.index,
        label: incompleteLabel(pendingUser),
        isGuideRequest: true,
        status: "aborted",
        content: "",
        streaming: false,
        branchAnchorId,
        branchInfo,
      });
      pendingUser = null;
      return;
    }
    const { branchAnchorId, branchInfo } = branchForIndex(
      pendingUser.index,
      branchAnchors,
      branchNavigation,
    );
    const qa: GuideSideQaNode = {
      id: `qa-${pendingUser.index}`,
      userMessageIndex: pendingUser.index,
      question: pendingUser.content,
      selection: pendingUser.selection,
      chapterHref: pendingUser.chapterHref,
      answer: "",
      streaming: isSpineStreaming && pendingUser.index === lastChatIndex,
      branchAnchorId,
      branchInfo,
    };
    if (currentStep) currentStep.sideThreads.push(qa);
    else orphanSideThreads.push(qa);
    pendingUser = null;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.role === "guide_cut") {
      flushPendingUser();
      markers.push({
        kind: "guide_cut",
        messageIndex: index,
        afterStepIndex: currentStep ? currentStep.stepIndex : null,
        marker: message,
      });
      continue;
    }

    if (message.role === "notice") {
      flushPendingUser();
      markers.push({
        kind: "compaction",
        messageIndex: index,
        afterStepIndex: currentStep ? currentStep.stepIndex : null,
        notice: message,
      });
      continue;
    }

    if (message.role === "recap") {
      // Chapter recaps are silent model-only memory entries.
      continue;
    }

    if (message.role === "user") {
      // Flush any earlier unanswered user message before starting a new one.
      flushPendingUser();

      if (message.guide) {
        const start = stepChapterStart(message.guide);
        const { branchAnchorId, branchInfo } = branchForIndex(index, branchAnchors, branchNavigation);
        const node: GuideStepNode = {
          stepIndex: steps.length,
          id: `step-${steps.length}`,
          step: message.guide,
          label: message.content || guideStepLabel(message.guide),
          chapterIndex: start.chapterIndex,
          chapterTitle: start.chapterTitle,
          endChapterIndex: stepChapterEnd(message.guide),
          messageIndex: index,
          requestMessageIndex: index,
          explanation: "",
          streaming: false,
          branchAnchorId,
          branchInfo,
          sideThreads: [],
        };
        steps.push(node);
        currentStep = node;
      } else {
        pendingUser = {
          index,
          content: message.content,
          selection: message.selection,
          chapterHref: message.chapterHref,
          isGuideRequest: !!message.guideRequest,
          guideStep: message.guideRequest?.step,
        };
      }
      continue;
    }

    if (message.role === "assistant") {
      const streamingThis = isSpineStreaming && index === lastChatIndex;
      const toolCalls = (message.blocks ?? []).flatMap((block) =>
        block.type === "toolCall" ? [block.toolCall] : [],
      );
      const takenCalls = toolCalls.filter((call) => !!call.guide);
      const inFlightGuideCalls = streamingThis
        ? toolCalls.filter((call) => !call.guide && call.tool === "guide_step" && !call.done)
        : [];
      const hasGuideStepCall = toolCalls.some((call) => call.tool === "guide_step");

      if (takenCalls.length > 0) {
        const reqIndex = pendingUser?.index;
        const reqText = pendingUser && !pendingUser.isGuideRequest ? pendingUser.content : undefined;
        const { branchAnchorId, branchInfo } = preferAssistantBranch(index, reqIndex, branchAnchors, branchNavigation);
        pendingUser = null;

        takenCalls.forEach((call, callIdx) => {
          const step = call.guide!;
          const start = stepChapterStart(step);
          const isLastCallInMsg = callIdx === takenCalls.length - 1;
          const node: GuideStepNode = {
            stepIndex: steps.length,
            id: `step-${steps.length}-${call.toolCallId}`,
            step,
            label: guideStepLabel(step),
            chapterIndex: start.chapterIndex,
            chapterTitle: start.chapterTitle,
            endChapterIndex: stepChapterEnd(step),
            messageIndex: index,
            requestMessageIndex: reqIndex,
            requestText: callIdx === 0 ? reqText : undefined,
            toolCallId: call.toolCallId,
            // Only attach the assistant prose once when a single reply took multiple steps.
            explanation: isLastCallInMsg ? message.content : "",
            blocks: isLastCallInMsg ? message.blocks : undefined,
            streaming: streamingThis && isLastCallInMsg,
            stopReason: isLastCallInMsg ? message.stopReason : undefined,
            errorMessage: isLastCallInMsg ? message.errorMessage : undefined,
            branchAnchorId: callIdx === 0 ? branchAnchorId : undefined,
            branchInfo: callIdx === 0 ? branchInfo : undefined,
            sideThreads: [],
          };
          steps.push(node);
          currentStep = node;
        });
      } else if (inFlightGuideCalls.length > 0) {
        const reqIndex = pendingUser?.index;
        pendingUser = null;
        for (const call of inFlightGuideCalls) {
          pendingSteps.push({
            id: `pending-${index}-${call.toolCallId}`,
            messageIndex: index,
            requestMessageIndex: reqIndex,
            toolCallId: call.toolCallId,
          });
        }
      } else if (pendingUser && (pendingUser.isGuideRequest || hasGuideStepCall)) {
        // An uncommitted guided-step turn (aborted, errored, pre-tool streaming,
        // or replied without calling guide_step): never demote to a side question.
        const { branchAnchorId, branchInfo } = preferAssistantBranch(
          index,
          pendingUser.index,
          branchAnchors,
          branchNavigation,
        );
        const status: GuideIncompleteStepStatus = streamingThis
          ? "streaming"
          : message.stopReason === "aborted"
            ? "aborted"
            : message.stopReason === "error"
              ? "error"
              : "replied";
        incompleteSteps.push({
          id: `incomplete-${pendingUser.index}`,
          afterStepIndex: currentStep ? currentStep.stepIndex : null,
          requestMessageIndex: pendingUser.index,
          assistantMessageIndex: index,
          label: incompleteLabel(pendingUser),
          isGuideRequest: pendingUser.isGuideRequest,
          status,
          content: message.content,
          blocks: message.blocks,
          streaming: streamingThis,
          stopReason: message.stopReason,
          errorMessage: message.errorMessage,
          branchAnchorId,
          branchInfo,
        });
        pendingUser = null;
      } else if (pendingUser) {
        const { branchAnchorId, branchInfo } = branchForIndex(
          pendingUser.index,
          branchAnchors,
          branchNavigation,
        );
        const assistantBranch = branchForIndex(index, branchAnchors, branchNavigation);
        const qa: GuideSideQaNode = {
          id: `qa-${pendingUser.index}`,
          userMessageIndex: pendingUser.index,
          assistantMessageIndex: index,
          question: pendingUser.content,
          selection: pendingUser.selection,
          chapterHref: pendingUser.chapterHref,
          answer: message.content,
          blocks: message.blocks,
          streaming: streamingThis,
          stopReason: message.stopReason,
          errorMessage: message.errorMessage,
          branchAnchorId,
          branchInfo,
          assistantBranchAnchorId: assistantBranch.branchAnchorId,
          assistantBranchInfo: assistantBranch.branchInfo,
        };
        if (currentStep) currentStep.sideThreads.push(qa);
        else orphanSideThreads.push(qa);
        pendingUser = null;
      } else if (currentStep && !currentStep.explanation && !currentStep.blocks) {
        // Legacy user-message step whose assistant explanation sits in the next message.
        currentStep.explanation = message.content;
        currentStep.blocks = message.blocks;
        currentStep.streaming = streamingThis;
        currentStep.stopReason = message.stopReason;
        currentStep.errorMessage = message.errorMessage;
      }
    }
  }

  // Trailing unanswered user message (e.g., optimistic message right before assistant starts).
  flushPendingUser(true);

  // Build chronological chapter runs for document-flow rendering.
  let nextSyntheticIndex = messages.length + 1000;
  const allocateSideIndex = () => nextSyntheticIndex++;

  // Append pre-guide off-spine root side-thread Q&As into orphanSideThreads.
  if (sideThreads?.[ROOT_SIDE_THREAD_KEY]) {
    orphanSideThreads.push(
      ...projectSideThreadSnapshot(
        ROOT_SIDE_THREAD_KEY,
        sideThreads[ROOT_SIDE_THREAD_KEY],
        isStreaming && activeSideThreadKey === ROOT_SIDE_THREAD_KEY,
        allocateSideIndex,
      ),
    );
  }

  const runs: GuideChapterRun[] = [];
  const seenChapters = new Set<number>();
  for (const step of steps) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && lastRun.chapterIndex === step.chapterIndex) {
      lastRun.steps.push(step);
    } else {
      const isReread = seenChapters.has(step.chapterIndex);
      seenChapters.add(step.chapterIndex);
      const anchorIndex = step.requestMessageIndex ?? step.messageIndex;
      const anchorEntryId = branchAnchors?.[anchorIndex] ?? null;
      runs.push({
        id: `run-${runs.length}-ch-${step.chapterIndex}`,
        anchorEntryId,
        chapterIndex: step.chapterIndex,
        chapterTitle: step.chapterTitle,
        isReread,
        steps: [step],
        sideThreads: [],
      });
    }
  }

  // Populate chapter-level `run.sideThreads` from both legacy inline Q&As and
  // off-spine chapter side-threads (matching either the run's primary anchor or
  // any step anchor within the run).
  for (const run of runs) {
    for (const step of run.steps) {
      run.sideThreads.push(...step.sideThreads);
    }
    if (sideThreads) {
      const matchedKeys = new Set<string>();
      if (run.anchorEntryId && sideThreads[run.anchorEntryId]) {
        matchedKeys.add(run.anchorEntryId);
      }
      for (const step of run.steps) {
        const reqAnchor =
          step.requestMessageIndex !== undefined ? branchAnchors?.[step.requestMessageIndex] : undefined;
        const msgAnchor = branchAnchors?.[step.messageIndex];
        if (reqAnchor && sideThreads[reqAnchor]) matchedKeys.add(reqAnchor);
        if (msgAnchor && sideThreads[msgAnchor]) matchedKeys.add(msgAnchor);
      }
      for (const stKey of matchedKeys) {
        run.sideThreads.push(
          ...projectSideThreadSnapshot(
            stKey,
            sideThreads[stKey],
            isStreaming && activeSideThreadKey === stKey,
            allocateSideIndex,
          ),
        );
      }
    }
  }

  // Build TOC-aligned chapter summaries.
  const stepsByChapter = new Map<number, GuideStepNode[]>();
  const questionsByChapter = new Map<number, number>();
  for (const step of steps) {
    const list = stepsByChapter.get(step.chapterIndex) ?? [];
    list.push(step);
    stepsByChapter.set(step.chapterIndex, list);
  }
  for (const run of runs) {
    questionsByChapter.set(
      run.chapterIndex,
      (questionsByChapter.get(run.chapterIndex) ?? 0) + run.sideThreads.length,
    );
  }

  const chapters: GuideChapterNode[] = [];
  const listedChapterIndices = new Set<number>();

  if (toc && toc.length > 0) {
    toc.forEach((entry, fallbackIdx) => {
      const progress = entry.href ? tocProgress?.[entry.href] : undefined;
      const chapterIndex = entry.chapterIndex ?? fallbackIdx;
      const chapterSteps = stepsByChapter.get(chapterIndex) ?? [];
      listedChapterIndices.add(chapterIndex);
      const status = resolveChapterStatus(progress, chapterSteps);
      const questionCount = questionsByChapter.get(chapterIndex) ?? 0;
      chapters.push({
        chapterIndex,
        title: entry.label,
        href: entry.href || undefined,
        status,
        coveredBlocks: progress?.coveredBlocks ?? (chapterSteps.length > 0 ? 1 : 0),
        totalBlocks: progress?.totalBlocks ?? 1,
        isCurrent: Boolean(progress?.current),
        stepIndices: chapterSteps.map((s) => s.stepIndex),
        questionCount,
      });
    });
  } else {
    for (const [chapterIndex, chapterSteps] of [...stepsByChapter.entries()].sort((a, b) => a[0] - b[0])) {
      listedChapterIndices.add(chapterIndex);
      const status = resolveChapterStatus(undefined, chapterSteps);
      chapters.push({
        chapterIndex,
        title: chapterSteps[0]?.chapterTitle ?? positionTitle({ chapterIndex }),
        status,
        coveredBlocks: chapterSteps.length,
        totalBlocks: chapterSteps.length,
        isCurrent: false,
        stepIndices: chapterSteps.map((s) => s.stepIndex),
        questionCount: questionsByChapter.get(chapterIndex) ?? 0,
      });
    }
  }

  const totalQuestions =
    orphanSideThreads.length + runs.reduce((sum, run) => sum + run.sideThreads.length, 0);

  return {
    bookId,
    sessionId,
    steps,
    pendingSteps,
    incompleteSteps,
    runs,
    chapters,
    orphanSideThreads,
    markers,
    hasStarted: steps.length > 0,
    totalQuestions,
  };
}

function resolveChapterStatus(
  progress: GuideChapterProgress | undefined,
  chapterSteps: readonly GuideStepNode[],
): GuideChapterStatus {
  if (progress) {
    if (progress.coveredBlocks >= progress.totalBlocks) return "completed";
    if (progress.coveredBlocks > 0) return "in_progress";
    return "unread";
  }
  return chapterSteps.length > 0 ? "in_progress" : "unread";
}

export interface ActiveGuideRunState {
  activeRun: GuideChapterRun | null;
  activeRunIndex: number;
  latestRun: GuideChapterRun | null;
  isViewingHistory: boolean;
}

/**
 * Resolve which single `GuideChapterRun` is focused in chapter-scoped view.
 * `focusedRunId === null` follows the latest run; a stale id safely falls back
 * to the latest run.
 */
export function resolveActiveGuideRun(
  doc: GuideDocument,
  focusedRunId: string | null,
): ActiveGuideRunState {
  if (doc.runs.length === 0) {
    return { activeRun: null, activeRunIndex: -1, latestRun: null, isViewingHistory: false };
  }
  const latestIndex = doc.runs.length - 1;
  const latestRun = doc.runs[latestIndex];
  const foundIndex = focusedRunId
    ? doc.runs.findIndex((run) => run.id === focusedRunId)
    : -1;
  const activeRunIndex = foundIndex >= 0 ? foundIndex : latestIndex;
  const activeRun = doc.runs[activeRunIndex];
  return {
    activeRun,
    activeRunIndex,
    latestRun,
    isViewingHistory: activeRunIndex < latestIndex,
  };
}

/** Find the most recent run covering `chapterIndex`, or null if none exists. */
export function findRunIdForChapter(doc: GuideDocument, chapterIndex: number): string | null {
  for (let i = doc.runs.length - 1; i >= 0; i -= 1) {
    if (doc.runs[i].chapterIndex === chapterIndex) return doc.runs[i].id;
  }
  return null;
}

/** Find the run containing `stepIndex`, or null if not found. */
export function findRunIdForStep(doc: GuideDocument, stepIndex: number): string | null {
  for (const run of doc.runs) {
    if (run.steps.some((step) => step.stepIndex === stepIndex)) return run.id;
  }
  return null;
}

/** Find the run owning a visible transcript `messageIndex` (step, question, marker, or incomplete attempt). */
export function findRunIdForMessage(doc: GuideDocument, messageIndex: number): string | null {
  if (
    doc.orphanSideThreads.some(
      (qa) => qa.userMessageIndex === messageIndex || qa.assistantMessageIndex === messageIndex,
    )
  ) {
    return doc.runs[0]?.id ?? null;
  }
  for (const run of doc.runs) {
    for (const step of run.steps) {
      if (step.messageIndex === messageIndex || step.requestMessageIndex === messageIndex) {
        return run.id;
      }
    }
    if (
      run.sideThreads.some(
        (qa) => qa.userMessageIndex === messageIndex || qa.assistantMessageIndex === messageIndex,
      )
    ) {
      return run.id;
    }
  }
  const incomplete = doc.incompleteSteps.find(
    (attempt) =>
      attempt.requestMessageIndex === messageIndex ||
      attempt.assistantMessageIndex === messageIndex,
  );
  if (incomplete) {
    return incomplete.afterStepIndex === null
      ? (doc.runs[0]?.id ?? null)
      : findRunIdForStep(doc, incomplete.afterStepIndex);
  }
  const marker = doc.markers.find((item) => item.messageIndex === messageIndex);
  if (marker) {
    return marker.afterStepIndex === null
      ? (doc.runs[0]?.id ?? null)
      : findRunIdForStep(doc, marker.afterStepIndex);
  }
  if (
    doc.pendingSteps.some(
      (pending) =>
        pending.messageIndex === messageIndex || pending.requestMessageIndex === messageIndex,
    )
  ) {
    return doc.runs[doc.runs.length - 1]?.id ?? null;
  }
  return null;
}

/** Whether `messageIndex` belongs to a follow-up side question (user or assistant bubble). */
export function findSideQuestionUserIndex(doc: GuideDocument, messageIndex: number): number | null {
  for (const qa of doc.orphanSideThreads) {
    if (qa.userMessageIndex === messageIndex || qa.assistantMessageIndex === messageIndex) {
      return qa.userMessageIndex;
    }
  }
  for (const run of doc.runs) {
    for (const qa of run.sideThreads) {
      if (qa.userMessageIndex === messageIndex || qa.assistantMessageIndex === messageIndex) {
        return qa.userMessageIndex;
      }
    }
  }
  return null;
}

export interface GuideSearchHit {
  id: string;
  kind: "step" | "question";
  runId: string;
  chapterIndex: number;
  chapterTitle: string;
  label: string;
  messageIndex: number;
  snippet: string;
}

function makeSnippet(text: string, lowerQuery: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const offset = collapsed.toLowerCase().indexOf(lowerQuery);
  if (offset < 0) return null;
  const start = Math.max(0, offset - 28);
  const end = Math.min(collapsed.length, offset + lowerQuery.length + 64);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < collapsed.length ? "…" : "";
  return `${prefix}${collapsed.slice(start, end).trim()}${suffix}`;
}

/**
 * Instant client-side search across all covered steps and side questions in a
 * `GuideDocument`, used by the chapter switcher popover so single-chapter
 * mounting never sacrifices whole-book findability.
 */
export function searchGuideDocument(
  doc: GuideDocument,
  rawQuery: string,
  limit = 24,
): GuideSearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query || limit <= 0) return [];
  const hits: GuideSearchHit[] = [];

  if (doc.runs.length > 0) {
    const firstRun = doc.runs[0];
    for (const qa of doc.orphanSideThreads) {
      const snippet = makeSnippet(qa.question, query) ?? makeSnippet(qa.answer, query);
      if (!snippet) continue;
      hits.push({
        id: `hit-${qa.id}`,
        kind: "question",
        runId: firstRun.id,
        chapterIndex: firstRun.chapterIndex,
        chapterTitle: firstRun.chapterTitle,
        label: qa.question,
        messageIndex: qa.userMessageIndex,
        snippet,
      });
      if (hits.length >= limit) return hits;
    }
  }

  for (const run of doc.runs) {
    for (const step of run.steps) {
      const stepSnippet =
        makeSnippet(step.explanation, query) ??
        makeSnippet(step.label, query) ??
        makeSnippet(step.chapterTitle, query);
      if (stepSnippet) {
        hits.push({
          id: `hit-${step.id}`,
          kind: "step",
          runId: run.id,
          chapterIndex: run.chapterIndex,
          chapterTitle: run.chapterTitle,
          label: step.label,
          messageIndex: step.messageIndex,
          snippet: stepSnippet,
        });
        if (hits.length >= limit) return hits;
      }
    }
    for (const qa of run.sideThreads) {
      const qaSnippet = makeSnippet(qa.question, query) ?? makeSnippet(qa.answer, query);
      if (!qaSnippet) continue;
      hits.push({
        id: `hit-${qa.id}`,
        kind: "question",
        runId: run.id,
        chapterIndex: run.chapterIndex,
        chapterTitle: run.chapterTitle,
        label: qa.question,
        messageIndex: qa.userMessageIndex,
        snippet: qaSnippet,
      });
      if (hits.length >= limit) return hits;
    }
  }

  return hits;
}
