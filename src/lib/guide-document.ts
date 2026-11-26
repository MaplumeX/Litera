import { guideStepLabel, positionTitle } from "@/components/chat/GuideBar";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import type {
  AgentMessage,
  AnchorBranchInfo,
  AssistantBlock,
  CompactionNotice,
  GuideContextCutMarker,
  RecordedGuideStep,
} from "@/types/agent";

export interface GuideSideQaNode {
  id: string;
  userMessageIndex: number;
  assistantMessageIndex?: number;
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
  chapterIndex: number;
  chapterTitle: string;
  /** True when an earlier run already covered this chapter (a re-read). */
  isReread: boolean;
  steps: GuideStepNode[];
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
  isStreaming = false,
  toc,
  tocProgress,
}: ProjectGuideDocumentInput): GuideDocument {
  const steps: GuideStepNode[] = [];
  const pendingSteps: GuidePendingStepNode[] = [];
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
  } | null = null;

  const flushPendingUserAsSideQuestion = () => {
    if (!pendingUser || pendingUser.isGuideRequest) {
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
      streaming: isStreaming && pendingUser.index === lastChatIndex,
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
      flushPendingUserAsSideQuestion();
      markers.push({
        kind: "guide_cut",
        messageIndex: index,
        afterStepIndex: currentStep ? currentStep.stepIndex : null,
        marker: message,
      });
      continue;
    }

    if (message.role === "notice") {
      flushPendingUserAsSideQuestion();
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
      // Flush any earlier unanswered user question before starting a new one.
      flushPendingUserAsSideQuestion();

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
        };
      }
      continue;
    }

    if (message.role === "assistant") {
      const streamingThis = isStreaming && index === lastChatIndex;
      const toolCalls = (message.blocks ?? []).flatMap((block) =>
        block.type === "toolCall" ? [block.toolCall] : [],
      );
      const takenCalls = toolCalls.filter((call) => !!call.guide);
      const inFlightGuideCalls = streamingThis
        ? toolCalls.filter((call) => !call.guide && call.tool === "guide_step" && !call.done)
        : [];

      if (takenCalls.length > 0) {
        const reqIndex = pendingUser?.index;
        const reqText = pendingUser && !pendingUser.isGuideRequest ? pendingUser.content : undefined;
        const { branchAnchorId, branchInfo } = branchForIndex(reqIndex, branchAnchors, branchNavigation);
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
      } else if (pendingUser && !pendingUser.isGuideRequest) {
        const { branchAnchorId, branchInfo } = branchForIndex(
          pendingUser.index,
          branchAnchors,
          branchNavigation,
        );
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
        };
        if (currentStep) currentStep.sideThreads.push(qa);
        else orphanSideThreads.push(qa);
        pendingUser = null;
      } else if (pendingUser && pendingUser.isGuideRequest) {
        // A guideRequest whose assistant reply failed/aborted or replied without calling guide_step.
        const { branchAnchorId, branchInfo } = branchForIndex(
          pendingUser.index,
          branchAnchors,
          branchNavigation,
        );
        const qa: GuideSideQaNode = {
          id: `qa-${pendingUser.index}`,
          userMessageIndex: pendingUser.index,
          assistantMessageIndex: index,
          question: pendingUser.content,
          answer: message.content,
          blocks: message.blocks,
          streaming: streamingThis,
          stopReason: message.stopReason,
          errorMessage: message.errorMessage,
          branchAnchorId,
          branchInfo,
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

  // Trailing unanswered user question (e.g., optimistic message right before assistant starts).
  flushPendingUserAsSideQuestion();

  // Build chronological chapter runs for document-flow rendering.
  const runs: GuideChapterRun[] = [];
  const seenChapters = new Set<number>();
  for (const step of steps) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && lastRun.chapterIndex === step.chapterIndex) {
      lastRun.steps.push(step);
    } else {
      const isReread = seenChapters.has(step.chapterIndex);
      seenChapters.add(step.chapterIndex);
      runs.push({
        id: `run-${runs.length}-ch-${step.chapterIndex}`,
        chapterIndex: step.chapterIndex,
        chapterTitle: step.chapterTitle,
        isReread,
        steps: [step],
      });
    }
  }

  // Build TOC-aligned chapter summaries.
  const stepsByChapter = new Map<number, GuideStepNode[]>();
  for (const step of steps) {
    const list = stepsByChapter.get(step.chapterIndex) ?? [];
    list.push(step);
    stepsByChapter.set(step.chapterIndex, list);
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
      const questionCount = chapterSteps.reduce((sum, s) => sum + s.sideThreads.length, 0);
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
        questionCount: chapterSteps.reduce((sum, s) => sum + s.sideThreads.length, 0),
      });
    }
  }

  const totalQuestions =
    orphanSideThreads.length + steps.reduce((sum, step) => sum + step.sideThreads.length, 0);

  return {
    bookId,
    sessionId,
    steps,
    pendingSteps,
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
