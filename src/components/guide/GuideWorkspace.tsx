import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentConfigDialog } from "@/components/AgentConfigDialog";
import { ChatOutlineRail, userMessagePreview, type ChatOutlineItem } from "@/components/chat/ChatOutlineRail";
import { CitationContext } from "@/components/chat/Citation";
import { CompactionStatus } from "@/components/chat/CompactionNotice";
import { EmptyState } from "@/components/chat/EmptyState";
import { guideStepLabel } from "@/components/chat/GuideBar";
import { GuideRangePicker } from "@/components/chat/GuideRangePicker";
import { GuideStepMarkerPlaceholder } from "@/components/chat/GuideStepMarker";
import { ModelSwitcher } from "@/components/chat/ModelSwitcher";
import { SessionConfigDialog, type SessionConfigTarget } from "@/components/chat/SessionConfigDialog";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { GuideChapterBar, GuideChapterFooter } from "./GuideChapterBar";
import { GuideChapterGroup, GuideTimelineDivider } from "./GuideChapterGroup";
import { GuideControlDock } from "./GuideControlDock";
import { GuideIncompleteStepCard } from "./GuideIncompleteStepCard";
import { GuideSideThread } from "./GuideSideThread";
import type { GuideStepAction } from "./GuideStepSection";
import type { QuoteLocation } from "@/agent/book/book-content";
import { listBuiltinModelIds } from "@/agent/runtime/model-resolution";
import { canonicalGuidedSession, sideThreadAnchorFromKey } from "@/agent/sessions/pi-session";
import type { GuideBlockTarget } from "@/lib/guide-marks";
import {
  findRunIdForChapter,
  findRunIdForMessage,
  findRunIdForStep,
  findSideQuestionUserIndex,
  projectGuideDocument,
  resolveActiveGuideRun,
  type GuideChapterRun,
  type GuideDocument,
  type GuideIncompleteStepNode,
  type GuideSearchHit,
  type GuideSideQaNode,
  type GuideStepNode,
  type GuideTimelineMarker,
} from "@/lib/guide-document";
import { useGuideBridge } from "@/lib/use-guide-bridge";
import { useAssistantModelControls } from "@/lib/use-assistant-model-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tip } from "@/components/ui/tooltip";
import { useCitationActions } from "@/lib/use-citation-actions";
import { useTranscriptScroll } from "@/lib/use-transcript-scroll";
import {
  clampSessionRailWidth,
  loadSessionRailWidth,
  saveSessionRailWidth,
} from "@/lib/session-rail-width";
import { chatActivity, type ChatActivity } from "@/lib/chat-activity";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  isTranscriptMarker,
  type GuideRequest,
  type GuideSelection,
  type GuideStep,
  type GuideStepPace,
  type RecordedGuideStep,
  type StepRevisionOptions,
} from "@/types/agent";
import { CHATGPT_PROVIDER_ID, isCustomProviderId } from "@/types/agent-config";

export interface GuideWorkspaceHandle {
  fillInput: (text: string, chapterHref?: string) => void;
  guideTo: (selection: GuideSelection) => void;
  guideChapter: (href: string) => void;
  scrollToMessage: (messageIndex: number) => void;
  scrollToStep: (stepIndex: number) => void;
  scrollToChapter: (chapterIndex: number) => void;
  scrollToQuestion: (userMessageIndex: number) => void;
  openSettings: () => void;
}

export interface GuideWorkspaceProps {
  bookId: string;
  currentChapterHref?: string;
  onOpenQuote?: (location: QuoteLocation, quote: string, block?: GuideBlockTarget) => void;
  variant?: "docked" | "workspace";
  /** Desktop workspace: show the left navigation rail (owned by the titlebar toggle). */
  navRailOpen?: boolean;
  /** Optional custom left rail renderer (e.g. `GuideNavRail`). */
  renderNavRail?: (ctx: {
    document: GuideDocument;
    activeChapterIndex: number | null;
    archivedSessions: ReturnType<typeof useGuideBridge>["state"]["sessions"];
    viewingArchivedId: string | null;
    isStreaming: boolean;
    onScrollToChapter: (chapterIndex: number) => void;
    onScrollToStep: (stepIndex: number) => void;
    onScrollToQuestion: (userMessageIndex: number) => void;
    onGuideChapter: (href: string) => void;
    onOpenSettings: () => void;
    onViewArchived: (sessionId: string) => void;
    onReturnToCanonical: () => void;
  }) => ReactNode;
  /** Optional bridge injected when wrapped by another host. */
  bridge?: ReturnType<typeof useGuideBridge>;
  /** Auto-activate or create the canonical Guided session when mounted standalone. */
  autoActivateCanonical?: boolean;
  onActivityChange?: (activity: ChatActivity) => void;
  /** Declarative per-step extension actions (e.g. Save as note). */
  extraStepActions?: (step: GuideStepNode) => readonly GuideStepAction[];
  /** Optional controls beside the progression bar (e.g. explanation pace selector). */
  progressionExtras?: ReactNode;
  /** Optional hook to enrich outgoing `guideRequest` options (e.g. pace override). */
  transformGuideRequest?: (request: GuideRequest) => GuideRequest;
}

/**
 * First-class companion-book workspace for Guided reading: renders chapters,
 * step sections, inline figures, and anchored collapsible side-threads instead
 * of a flat chat transcript.
 */
export const GuideWorkspace = forwardRef<GuideWorkspaceHandle, GuideWorkspaceProps>(
  function GuideWorkspace(
    {
      bookId,
      currentChapterHref,
      onOpenQuote,
      variant = "workspace",
      navRailOpen = true,
      renderNavRail,
      bridge: injectedBridge,
      autoActivateCanonical = true,
      onActivityChange,
      extraStepActions,
      progressionExtras,
      transformGuideRequest,
    },
    ref,
  ) {
    const { t } = useT();
    const internalBridge = useGuideBridge(injectedBridge ? "" : bookId);
    const bridge = injectedBridge ?? internalBridge;
    const {
      state,
      abort,
      newGuidedSession,
      restartGuide,
      contextStats: guideContextStats,
      resetContext: resetGuideContext,
      nextStep: nextGuideStep,
      stepAfterChapter: guideStepAfterChapter,
      stepAtHref: guideStepAtHref,
      outline: guideOutline,
      stepTo: guideStepTo,
      stepToSelection: guideStepToSelection,
      stepAnchor: guideStepAnchor,
      stepImages: guideStepImages,
      readStepImageUrl,
      takeStep,
      askSideQuestion,
      editTurn: editPrompt,
      editSideTurn,
      regenerateTurn,
      regenerateSideTurn,
      reviseStep,
      selectStepRevision,
      undoLatestStep,
      dismissIncompleteTail,
      rollbackToChapterRun,
      switchSession,
      updateConfig: updateSessionConfig,
      switchBranchAtAnchor,
      switchSideBranchAtAnchor,
      locateQuote,
    } = bridge;
    const [pace, setPace] = useState<GuideStepPace>("standard");

    const citationActions = useCitationActions(bookId, locateQuote, onOpenQuote);
    const [input, setInput] = useState("");
    const [pendingSelection, setPendingSelection] = useState<{
      text: string;
      chapterHref?: string;
    } | null>(null);
    const [showConfig, setShowConfig] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [invokeError, setInvokeError] = useState<string | null>(null);
    const [configSession, setConfigSession] = useState<SessionConfigTarget | null>(null);
    const [editingQa, setEditingQa] = useState<GuideSideQaNode | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const [expandedQuestionIndex, setExpandedQuestionIndex] = useState<number | null>(null);
    const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
    const [viewingArchivedId, setViewingArchivedId] = useState<string | null>(null);
    const [computedStep, setComputedStep] = useState<GuideStep | null | undefined>(undefined);
    const [pickedStep, setPickedStep] = useState<GuideStep | null | undefined>(undefined);
    const [rangePickerOpen, setRangePickerOpen] = useState(false);
    const [railWidth, setRailWidth] = useState(loadSessionRailWidth);
    const railResizeRef = useRef<{ startX: number; startWidth: number; maxWidth: number } | null>(
      null,
    );
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const pendingJumpRef = useRef<
      | { kind: "top" }
      | { kind: "bottom"; smooth: boolean }
      | { kind: "item"; messageIndex: number }
      | null
    >(null);
    const autoInitRef = useRef<string | null>(null);

    const {
      configSnapshot,
      thinkingLevel,
      customModels,
      handleModelSelect,
      handleThinkingLevelChange,
    } = useAssistantModelControls(setInvokeError);

    const [providerModels, setProviderModels] = useState<string[]>([]);
    const activeProvider = configSnapshot?.provider ?? null;
    const activeModel = configSnapshot?.model ?? null;
    const customModelsKey = customModels.join("\0");
    useEffect(() => {
      const updateIfChanged = (next: string[]) => {
        setProviderModels((prev) =>
          prev.length === next.length && prev.every((id, idx) => id === next[idx]) ? prev : next,
        );
      };
      if (!activeProvider) {
        updateIfChanged([]);
        return;
      }
      if (
        isCustomProviderId(activeProvider) ||
        (activeProvider === CHATGPT_PROVIDER_ID && customModels.length > 0)
      ) {
        updateIfChanged(customModels);
        return;
      }
      let cancelled = false;
      void listBuiltinModelIds(activeProvider).then((ids) => {
        if (!cancelled) updateIfChanged(ids);
      });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProvider, customModelsKey]);

    const availableModels = useMemo(
      () =>
        activeModel && !providerModels.includes(activeModel)
          ? [activeModel, ...providerModels]
          : providerModels,
      [activeModel, providerModels],
    );

    const isWorkspace = variant === "workspace";
    const isStreaming = submitting || state.status === "prompting";
    const bookReady = state.status === "bookReady" || state.status === "prompting";
    const error = invokeError ?? state.error?.message ?? null;

    const canonical = useMemo(() => canonicalGuidedSession(state.sessions), [state.sessions]);
    const archivedGuidedSessions = useMemo(
      () =>
        state.sessions.filter(
          (session) => session.kind === "guided" && session.id !== canonical?.id,
        ),
      [canonical?.id, state.sessions],
    );
    const activeSession = useMemo(
      () => state.sessions.find((session) => session.id === state.sessionId),
      [state.sessionId, state.sessions],
    );
    const isGuided = activeSession?.kind === "guided";
    const isViewingArchived =
      Boolean(viewingArchivedId && state.sessionId === viewingArchivedId) ||
      Boolean(isGuided && canonical && activeSession?.id !== canonical.id);

    // Ensure the Book's canonical Guided session is active when mounted standalone in Guide mode.
    useEffect(() => {
      if (!autoActivateCanonical || state.status !== "bookReady" || isStreaming) return;
      if (viewingArchivedId) {
        if (state.sessionId !== viewingArchivedId) {
          void switchSession(viewingArchivedId).catch((err) => setInvokeError(String(err)));
        }
        return;
      }
      if (canonical) {
        if (state.sessionId === canonical.id) return;
        if (autoInitRef.current === canonical.id) return;
        autoInitRef.current = canonical.id;
        void switchSession(canonical.id).catch((err) => {
          autoInitRef.current = null;
          setInvokeError(String(err));
        });
      } else if (!isGuided) {
        // Wait for initial sessions list before creating a new canonical Guided session.
        if (state.sessionListRequestId !== null) return;
        if (autoInitRef.current === "__create__") return;
        autoInitRef.current = "__create__";
        void newGuidedSession().catch((err) => {
          autoInitRef.current = null;
          setInvokeError(String(err));
        });
      }
    }, [
      autoActivateCanonical,
      canonical,
      isGuided,
      isStreaming,
      newGuidedSession,
      state.sessionId,
      state.sessionListRequestId,
      state.status,
      switchSession,
      viewingArchivedId,
    ]);

    const document = useMemo<GuideDocument>(
      () =>
        projectGuideDocument({
          bookId,
          sessionId: state.sessionId,
          messages: isGuided ? state.messages : [],
          branchAnchors: state.branchAnchors,
          branchNavigation: state.branchNavigation,
          sideThreads: isGuided ? state.sideThreads : undefined,
          activeSideThreadKey: state.activeSideThreadKey,
          stepRevisions: isGuided ? state.stepRevisions : undefined,
          activeRevisionTarget: state.activeRevisionTarget,
          isStreaming,
        }),
      [
        bookId,
        isGuided,
        isStreaming,
        state.activeRevisionTarget,
        state.activeSideThreadKey,
        state.branchAnchors,
        state.branchNavigation,
        state.messages,
        state.sessionId,
        state.sideThreads,
        state.stepRevisions,
      ],
    );

    const guideStarted = document.hasStarted;
    const nextStep = pickedStep !== undefined ? pickedStep : computedStep;

    let lastChatIndex = -1;
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      if (!isTranscriptMarker(state.messages[i])) {
        lastChatIndex = i;
        break;
      }
    }
    const lastChatMessage = lastChatIndex >= 0 ? state.messages[lastChatIndex] : undefined;

    const activeMessagesForActivity = useMemo(() => {
      if (state.activeRevisionTarget) {
        const snap = state.stepRevisions[state.activeRevisionTarget.targetAnchorId];
        const rev = snap?.revisions.find(
          (item) => item.revisionId === state.activeRevisionTarget?.revisionId,
        );
        return rev
          ? [
              {
                role: "assistant" as const,
                content: rev.content,
                blocks: rev.blocks,
                stopReason: rev.stopReason,
                errorMessage: rev.errorMessage,
              },
            ]
          : [];
      }
      return state.activeSideThreadKey
        ? (state.sideThreads[state.activeSideThreadKey]?.messages ?? state.messages)
        : state.messages;
    }, [state.activeRevisionTarget, state.activeSideThreadKey, state.messages, state.sideThreads, state.stepRevisions]);
    const activity = chatActivity(activeMessagesForActivity, isStreaming);
    useEffect(() => {
      onActivityChange?.({
        answering: activity.answering,
        preview: activity.preview,
        failed: activity.failed,
      });
    }, [onActivityChange, activity.answering, activity.preview, activity.failed]);

    const { activeRun, activeRunIndex, latestRun, isViewingHistory } = useMemo(
      () => resolveActiveGuideRun(document, focusedRunId),
      [document, focusedRunId],
    );
    const isFirstRun = activeRunIndex === 0;
    const isLatestRun = !isViewingHistory;
    const prevRun = activeRunIndex > 0 ? document.runs[activeRunIndex - 1] : null;
    const nextRun =
      activeRunIndex >= 0 && activeRunIndex + 1 < document.runs.length
        ? document.runs[activeRunIndex + 1]
        : null;

    const outlineItems = useMemo<ChatOutlineItem[]>(() => {
      const items: ChatOutlineItem[] = [];
      if (!activeRun || isFirstRun) {
        for (const qa of document.orphanSideThreads) {
          items.push({
            messageIndex: qa.userMessageIndex,
            preview: userMessagePreview(qa.question),
            kind: "question",
          });
        }
      }
      if (activeRun) {
        for (const step of activeRun.steps) {
          items.push({
            messageIndex: step.messageIndex,
            preview: step.label,
            kind: "step",
          });
        }
        for (const qa of activeRun.sideThreads) {
          items.push({
            messageIndex: qa.userMessageIndex,
            preview: userMessagePreview(qa.question),
            kind: "question",
          });
        }
      }
      return items;
    }, [activeRun, document.orphanSideThreads, isFirstRun]);

    const trackedIndices = useMemo(
      () => outlineItems.map((item) => item.messageIndex),
      [outlineItems],
    );

    const scrollContentKey = useMemo(
      () => ({
        messages: state.messages,
        sideThreads: state.sideThreads,
        stepRevisions: state.stepRevisions,
      }),
      [state.messages, state.sideThreads, state.stepRevisions],
    );

    const scroll = useTranscriptScroll({
      bookId,
      sessionId: state.sessionId,
      isStreaming,
      contentKey: scrollContentKey,
      trackedIndices,
    });

    const activeChapterIndex = activeRun?.chapterIndex ?? null;

    const markersByAfterStep = useMemo(() => {
      const map = new Map<number, GuideTimelineMarker[]>();
      for (const marker of document.markers) {
        if (marker.afterStepIndex === null) continue;
        const list = map.get(marker.afterStepIndex) ?? [];
        list.push(marker);
        map.set(marker.afterStepIndex, list);
      }
      return map;
    }, [document.markers]);

    const leadingMarkers = useMemo(
      () => document.markers.filter((marker) => marker.afterStepIndex === null),
      [document.markers],
    );

    const incompleteStepsByAfterStep = useMemo(() => {
      const map = new Map<number, GuideIncompleteStepNode[]>();
      for (const attempt of document.incompleteSteps) {
        if (attempt.afterStepIndex === null) continue;
        const list = map.get(attempt.afterStepIndex) ?? [];
        list.push(attempt);
        map.set(attempt.afterStepIndex, list);
      }
      return map;
    }, [document.incompleteSteps]);

    const leadingIncompleteSteps = useMemo(
      () => document.incompleteSteps.filter((attempt) => attempt.afterStepIndex === null),
      [document.incompleteSteps],
    );

    const activeTailIncompleteId = useMemo(() => {
      const last = document.incompleteSteps[document.incompleteSteps.length - 1];
      if (!last) return null;
      return (last.afterStepIndex ?? -1) === document.steps.length - 1 ? last.id : null;
    }, [document.incompleteSteps, document.steps.length]);

    useEffect(() => {
      setInvokeError(null);
      setSubmitting(false);
      setEditingQa(null);
      setEditDraft("");
      setExpandedQuestionIndex(null);
      setFocusedRunId(null);
      setViewingArchivedId(null);
      pendingJumpRef.current = null;
      autoInitRef.current = null;
    }, [bookId]);

    useEffect(() => {
      setEditingQa(null);
      setEditDraft("");
      setPickedStep(undefined);
      setFocusedRunId(null);
      pendingJumpRef.current = null;
    }, [state.sessionId]);

    const executeJump = useCallback(
      (
        jump:
          | { kind: "top" }
          | { kind: "bottom"; smooth: boolean }
          | { kind: "item"; messageIndex: number },
      ) => {
        if (jump.kind === "top") {
          const container = scroll.scrollContainerRef.current;
          if (container) container.scrollTop = 0;
        } else if (jump.kind === "bottom") {
          scroll.scrollToBottom(jump.smooth);
        } else {
          requestAnimationFrame(() => scroll.scrollToItem(jump.messageIndex));
        }
      },
      [scroll],
    );

    const focusRun = useCallback(
      (
        runId: string | null,
        jump:
          | { kind: "top" }
          | { kind: "bottom"; smooth: boolean }
          | { kind: "item"; messageIndex: number },
      ) => {
        const targetRunId = runId ?? latestRun?.id ?? null;
        const normalizedFocus =
          targetRunId && latestRun && targetRunId === latestRun.id ? null : targetRunId;
        if (!targetRunId || targetRunId === activeRun?.id) {
          setFocusedRunId(normalizedFocus);
          executeJump(jump);
          return;
        }
        pendingJumpRef.current = jump;
        setFocusedRunId(normalizedFocus);
      },
      [activeRun?.id, executeJump, latestRun],
    );

    useEffect(() => {
      const jump = pendingJumpRef.current;
      if (!jump) return;
      pendingJumpRef.current = null;
      executeJump(jump);
    }, [activeRun?.id, executeJump]);

    useEffect(() => {
      if (state.promptId || state.error) setSubmitting(false);
    }, [state.promptId, state.error]);

    useEffect(() => {
      if (!isGuided || !bookReady || isViewingArchived) {
        setComputedStep(undefined);
        return;
      }
      if (isStreaming) return;
      let cancelled = false;
      nextGuideStep(currentChapterHref)
        .then((step) => {
          if (!cancelled) setComputedStep(step);
        })
        .catch((err) => {
          if (!cancelled) setInvokeError(String(err));
        });
      return () => {
        cancelled = true;
      };
    }, [
      bookReady,
      currentChapterHref,
      isGuided,
      isStreaming,
      isViewingArchived,
      nextGuideStep,
      state.messages,
      state.sessionId,
    ]);

    const openGuideStep = useCallback(
      async (step: RecordedGuideStep) => {
        if (!onOpenQuote) return false;
        const anchor = await guideStepAnchor(step);
        if (!anchor?.href) return false;
        onOpenQuote(
          { status: "verified", chapterIndex: anchor.chapterIndex, href: anchor.href },
          anchor.snippet,
          anchor.target,
        );
        return true;
      },
      [guideStepAnchor, onOpenQuote],
    );

    const sendGuideRequest = useCallback(
      async (label: string, rawRequest: GuideRequest) => {
        if (isStreaming || !bookId || isViewingArchived) return;
        const guideRequest = transformGuideRequest ? transformGuideRequest(rawRequest) : rawRequest;
        setPickedStep(undefined);
        setEditingQa(null);
        setEditDraft("");
        setInvokeError(null);
        setSubmitting(true);
        focusRun(null, { kind: "bottom", smooth: true });
        try {
          await takeStep(label, guideRequest, { pace });
        } catch (err) {
          setInvokeError(String(err));
          setSubmitting(false);
        }
      },
      [bookId, focusRun, isStreaming, isViewingArchived, pace, takeStep, transformGuideRequest],
    );

    const sendGuideStep = useCallback(
      (step: GuideStep) => sendGuideRequest(guideStepLabel(step), { step }),
      [sendGuideRequest],
    );

    const handleGuideContinue = useCallback(() => {
      if (!nextStep) return;
      if (pickedStep || !guideStarted) void sendGuideStep(nextStep);
      else void sendGuideRequest(t("chat.guide.continueMessage"), {});
    }, [guideStarted, nextStep, pickedStep, sendGuideRequest, sendGuideStep, t]);

    const handleGuideSkip = useCallback(async () => {
      if (!nextStep || isStreaming) return;
      setInvokeError(null);
      try {
        setPickedStep(await guideStepAfterChapter(nextStep));
      } catch (err) {
        setInvokeError(String(err));
      }
    }, [guideStepAfterChapter, isStreaming, nextStep]);

    const loadGuideOutline = useCallback(
      (after?: number) =>
        nextStep ? guideOutline(nextStep, after) : Promise.resolve({ chapters: [], more: null }),
      [guideOutline, nextStep],
    );

    const handleGuideRangePick = useCallback(
      async (to: { chapterIndex: number; block: number }) => {
        if (!nextStep || isStreaming) return;
        setRangePickerOpen(false);
        setInvokeError(null);
        try {
          const step = await guideStepTo(nextStep, to);
          if (step) await sendGuideStep(step);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [guideStepTo, isStreaming, nextStep, sendGuideStep],
    );

    const handleSendQuestion = useCallback(async () => {
      const text = input.trim();
      if (!text || isStreaming || !bookId || isViewingArchived) return;
      setEditingQa(null);
      setEditDraft("");
      const selection = pendingSelection?.text;
      const chapterHref = pendingSelection?.chapterHref ?? currentChapterHref;
      const sideThreadAnchorId = activeRun?.anchorEntryId ?? null;
      setInput("");
      setPendingSelection(null);
      setInvokeError(null);
      setSubmitting(true);
      // Stay inside the viewed chapter run; follow-up Q&As branch per chapter.
      scroll.scrollToBottom(true);
      try {
        await askSideQuestion(text, { selection, chapterHref, sideThreadAnchorId });
      } catch (err) {
        setInput((current) => (current ? current : text));
        if (selection) {
          setPendingSelection((current) => current ?? { text: selection, chapterHref });
        }
        setInvokeError(String(err));
        setSubmitting(false);
      }
    }, [
      activeRun?.anchorEntryId,
      askSideQuestion,
      bookId,
      currentChapterHref,
      input,
      isStreaming,
      isViewingArchived,
      pendingSelection,
      scroll,
    ]);

    const handleAbort = useCallback(async () => {
      setInvokeError(null);
      try {
        await abort();
      } catch (err) {
        setInvokeError(String(err));
      }
    }, [abort]);

    const handleStartEditQa = useCallback(
      (qa: GuideSideQaNode) => {
        if (isStreaming || isViewingArchived) return;
        setEditingQa(qa);
        setEditDraft(qa.question);
      },
      [isStreaming, isViewingArchived],
    );

    const handleCancelEdit = useCallback(() => {
      setEditingQa(null);
      setEditDraft("");
    }, []);

    const handleSaveEdit = useCallback(async () => {
      if (!editingQa || isViewingArchived) return;
      const text = editDraft.trim();
      if (!text || isStreaming || !bookId) return;
      const qa = editingQa;
      const { selection, chapterHref } = qa;
      setEditingQa(null);
      setInvokeError(null);
      setSubmitting(true);
      try {
        if (qa.sideThreadKey !== undefined && qa.sideMessageIndex !== undefined) {
          scroll.scrollToBottom(true);
          await editSideTurn(
            sideThreadAnchorFromKey(qa.sideThreadKey),
            qa.sideMessageIndex,
            text,
            { selection, chapterHref },
            { role: "user", content: text, selection, chapterHref },
          );
        } else {
          focusRun(null, { kind: "bottom", smooth: true });
          await editPrompt(
            qa.userMessageIndex,
            text,
            { selection, chapterHref },
            { role: "user", content: text, selection, chapterHref },
          );
        }
        setEditDraft("");
      } catch (err) {
        setInvokeError(String(err));
        setSubmitting(false);
        setEditingQa(qa);
      }
    }, [
      bookId,
      editDraft,
      editPrompt,
      editSideTurn,
      editingQa,
      focusRun,
      isStreaming,
      isViewingArchived,
      scroll,
    ]);

    const handleRegenerate = useCallback(
      async (atIndex?: number) => {
        if (isViewingArchived) return;
        const start =
          atIndex === undefined
            ? state.messages.length - 1
            : Math.min(atIndex, state.messages.length - 1);
        let targetIndex = -1;
        for (let i = start; i >= 0; i--) {
          if (state.messages[i].role === "user") {
            targetIndex = i;
            break;
          }
        }
        if (targetIndex < 0 || isStreaming || !bookId) return;
        const original = state.messages[targetIndex];
        if (!original || original.role !== "user") return;
        const rawReq =
          original.guideRequest ?? (original.guide ? { step: original.guide } : undefined);
        const withPace: GuideRequest | undefined = rawReq
          ? {
              ...rawReq,
              ...(pace !== "standard" ? { pace } : {}),
            }
          : undefined;
        if (withPace && pace === "standard") delete withPace.pace;
        const guideRequest =
          withPace && transformGuideRequest ? transformGuideRequest(withPace) : withPace;
        setEditingQa(null);
        setEditDraft("");
        setInvokeError(null);
        setSubmitting(true);
        focusRun(null, { kind: "bottom", smooth: true });
        try {
          const legacyGuide = Boolean(original.guide && !original.guideRequest);
          const requestChanged =
            Boolean(rawReq) &&
            JSON.stringify(guideRequest) !== JSON.stringify(rawReq);
          if (legacyGuide || requestChanged) {
            await editPrompt(
              targetIndex,
              original.content,
              { selection: original.selection, chapterHref: original.chapterHref, guideRequest },
              {
                role: "user",
                content: original.content,
                selection: original.selection,
                chapterHref: original.chapterHref,
                ...(guideRequest ? { guideRequest } : {}),
              },
            );
          } else {
            await regenerateTurn(targetIndex);
          }
        } catch (err) {
          setInvokeError(String(err));
          setSubmitting(false);
        }
      },
      [bookId, editPrompt, focusRun, isStreaming, isViewingArchived, regenerateTurn, state.messages, transformGuideRequest],
    );

    const handleRegenerateQa = useCallback(
      async (qa: GuideSideQaNode) => {
        if (isViewingArchived || isStreaming || !bookId) return;
        if (qa.sideThreadKey !== undefined && qa.sideMessageIndex !== undefined) {
          setEditingQa(null);
          setEditDraft("");
          setInvokeError(null);
          setSubmitting(true);
          scroll.scrollToBottom(true);
          try {
            await regenerateSideTurn(
              sideThreadAnchorFromKey(qa.sideThreadKey),
              qa.sideMessageIndex,
            );
          } catch (err) {
            setInvokeError(String(err));
            setSubmitting(false);
          }
          return;
        }
        await handleRegenerate(qa.assistantMessageIndex ?? qa.userMessageIndex);
      },
      [bookId, handleRegenerate, isStreaming, isViewingArchived, regenerateSideTurn, scroll],
    );

    const handleSwitchBranch = useCallback(
      async (anchorId: string, direction: -1 | 1) => {
        if (isStreaming || isViewingArchived) return;
        if (editingQa) {
          setEditingQa(null);
          setEditDraft("");
        }
        setInvokeError(null);
        try {
          await switchBranchAtAnchor(anchorId, direction);
          scroll.scrollToBottom(false);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [editingQa, isStreaming, isViewingArchived, scroll, switchBranchAtAnchor],
    );

    const handleSwitchQaBranch = useCallback(
      async (qa: GuideSideQaNode, anchorId: string, direction: -1 | 1) => {
        if (isStreaming || isViewingArchived) return;
        if (editingQa) {
          setEditingQa(null);
          setEditDraft("");
        }
        setInvokeError(null);
        try {
          if (qa.sideThreadKey !== undefined) {
            await switchSideBranchAtAnchor(qa.sideThreadKey, anchorId, direction);
          } else {
            await switchBranchAtAnchor(anchorId, direction);
            scroll.scrollToBottom(false);
          }
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [editingQa, isStreaming, isViewingArchived, scroll, switchBranchAtAnchor, switchSideBranchAtAnchor],
    );

    const handleReviseStep = useCallback(
      async (targetAnchorId: string, options: StepRevisionOptions) => {
        if (isStreaming || isViewingArchived || !bookId) return;
        setEditingQa(null);
        setEditDraft("");
        setInvokeError(null);
        setSubmitting(true);
        // Stay anchored on the viewed chapter run during off-spine in-place revision.
        try {
          await reviseStep(targetAnchorId, options);
        } catch (err) {
          setInvokeError(String(err));
          setSubmitting(false);
        }
      },
      [bookId, isStreaming, isViewingArchived, reviseStep],
    );

    const handleSelectRevision = useCallback(
      async (targetAnchorId: string, revisionId: string) => {
        if (isStreaming || isViewingArchived) return;
        setInvokeError(null);
        try {
          await selectStepRevision(targetAnchorId, revisionId);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [isStreaming, isViewingArchived, selectStepRevision],
    );

    const handleUndoLatestStep = useCallback(async () => {
      if (isStreaming || isViewingArchived) return;
      setInvokeError(null);
      setPickedStep(undefined);
      try {
        await undoLatestStep();
      } catch (err) {
        setInvokeError(String(err));
      }
    }, [isStreaming, isViewingArchived, undoLatestStep]);

    const handleDismissIncompleteTail = useCallback(async () => {
      if (isStreaming || isViewingArchived) return;
      setInvokeError(null);
      try {
        await dismissIncompleteTail();
      } catch (err) {
        setInvokeError(String(err));
      }
    }, [dismissIncompleteTail, isStreaming, isViewingArchived]);

    const handleRetryIncompleteWithModel = useCallback(
      async (model: string, messageIndex: number) => {
        if (isStreaming || isViewingArchived) return;
        await handleModelSelect(model);
        await handleRegenerate(messageIndex);
      },
      [handleModelSelect, handleRegenerate, isStreaming, isViewingArchived],
    );

    const handleRollbackChapter = useCallback(
      async (run: GuideChapterRun) => {
        if (isStreaming || isViewingArchived || !run.anchorEntryId) return;
        setInvokeError(null);
        setPickedStep(undefined);
        try {
          await rollbackToChapterRun(run.anchorEntryId);
          setFocusedRunId(null);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [isStreaming, isViewingArchived, rollbackToChapterRun],
    );

    const handleSaveSessionConfig = useCallback(
      async (systemPrompt: string) => {
        const session = configSession;
        if (!session) return;
        setInvokeError(null);
        try {
          await updateSessionConfig(session.id, systemPrompt);
          setConfigSession(null);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [configSession, updateSessionConfig],
    );

    const fillInput = useCallback((text: string, chapterHref?: string) => {
      setPendingSelection({ text, chapterHref });
      setInput("");
      inputRef.current?.focus();
    }, []);

    const guideTo = useCallback(
      async (selection: GuideSelection) => {
        if (!isGuided || !nextStep || isViewingArchived) return;
        if (isStreaming) {
          setInvokeError(t("chat.guide.selectionBusy"));
          return;
        }
        setInvokeError(null);
        try {
          const result = await guideStepToSelection(nextStep, selection);
          if ("step" in result) await sendGuideStep(result.step);
          else
            setInvokeError(
              t(
                result.error === "before"
                  ? "chat.guide.selectionBefore"
                  : "chat.guide.selectionNotFound",
              ),
            );
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [guideStepToSelection, isGuided, isStreaming, isViewingArchived, nextStep, sendGuideStep, t],
    );

    const guideChapter = useCallback(
      async (href: string) => {
        if (!isGuided || !bookReady || isViewingArchived) return;
        if (isStreaming) {
          setInvokeError(t("chat.guide.selectionBusy"));
          return;
        }
        setInvokeError(null);
        try {
          const step = await guideStepAtHref(href);
          if (step) await sendGuideStep(step);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [bookReady, guideStepAtHref, isGuided, isStreaming, isViewingArchived, sendGuideStep, t],
    );

    const handleRereadChapter = useCallback(
      async (run: GuideChapterRun) => {
        if (!isGuided || !bookReady || isViewingArchived || isStreaming) return;
        const firstStep = run.steps[0];
        if (!firstStep) return;
        setInvokeError(null);
        try {
          const anchor = await guideStepAnchor(firstStep.step);
          const href =
            anchor?.href ??
            document.chapters.find((chapter) => chapter.chapterIndex === run.chapterIndex)?.href;
          if (href) await guideChapter(href);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [bookReady, document.chapters, guideChapter, guideStepAnchor, isGuided, isStreaming, isViewingArchived],
    );

    const handleSelectRun = useCallback(
      (runId: string) => {
        focusRun(runId, { kind: "top" });
      },
      [focusRun],
    );

    const handleJumpLatest = useCallback(() => {
      focusRun(null, { kind: "bottom", smooth: false });
    }, [focusRun]);

    const handleJumpToHit = useCallback(
      (hit: GuideSearchHit) => {
        if (hit.kind === "question") setExpandedQuestionIndex(hit.messageIndex);
        focusRun(hit.runId, { kind: "item", messageIndex: hit.messageIndex });
      },
      [focusRun],
    );

    const scrollToStep = useCallback(
      (stepIndex: number) => {
        const step = document.steps[stepIndex];
        if (!step) return;
        const runId = findRunIdForStep(document, stepIndex);
        focusRun(runId, { kind: "item", messageIndex: step.messageIndex });
      },
      [document, focusRun],
    );

    const scrollToChapter = useCallback(
      (chapterIndex: number) => {
        const runId = findRunIdForChapter(document, chapterIndex);
        if (runId) focusRun(runId, { kind: "top" });
      },
      [document, focusRun],
    );

    const scrollToQuestion = useCallback(
      (userMessageIndex: number) => {
        setExpandedQuestionIndex(userMessageIndex);
        const runId = findRunIdForMessage(document, userMessageIndex);
        focusRun(runId, { kind: "item", messageIndex: userMessageIndex });
      },
      [document, focusRun],
    );

    const scrollToMessage = useCallback(
      (messageIndex: number) => {
        const questionUserIndex = findSideQuestionUserIndex(document, messageIndex);
        if (questionUserIndex !== null) setExpandedQuestionIndex(questionUserIndex);
        const runId = findRunIdForMessage(document, messageIndex);
        focusRun(runId, { kind: "item", messageIndex });
      },
      [document, focusRun],
    );

    const openSettings = useCallback(() => {
      const target = activeSession ?? canonical;
      if (target) setConfigSession(target);
    }, [activeSession, canonical]);

    useImperativeHandle(
      ref,
      () => ({
        fillInput,
        guideTo: (selection) => void guideTo(selection),
        guideChapter: (href) => void guideChapter(href),
        scrollToMessage,
        scrollToStep,
        scrollToChapter,
        scrollToQuestion,
        openSettings,
      }),
      [
        fillInput,
        guideChapter,
        guideTo,
        openSettings,
        scrollToChapter,
        scrollToMessage,
        scrollToQuestion,
        scrollToStep,
      ],
    );

    const startRailResize = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const panel = e.currentTarget.parentElement;
        const panelWidth = panel?.getBoundingClientRect().width ?? window.innerWidth;
        railResizeRef.current = {
          startX: e.clientX,
          startWidth: railWidth,
          maxWidth: panelWidth / 2,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      [railWidth],
    );

    const onRailResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = railResizeRef.current;
      if (!drag) return;
      setRailWidth(
        clampSessionRailWidth(drag.startWidth + (e.clientX - drag.startX), drag.maxWidth),
      );
    }, []);

    const endRailResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = railResizeRef.current;
      if (!drag) return;
      railResizeRef.current = null;
      const next = clampSessionRailWidth(
        drag.startWidth + (e.clientX - drag.startX),
        drag.maxWidth,
      );
      setRailWidth(next);
      saveSessionRailWidth(next);
    }, []);

    const cancelRailResize = useCallback(() => {
      railResizeRef.current = null;
    }, []);

    const hasNavRail = isWorkspace && Boolean(renderNavRail);
    const showChapterBar = Boolean(
      activeRun && (document.runs.length >= 2 || !(hasNavRail && navRailOpen)),
    );
    const showOutlineRail = isWorkspace && outlineItems.length >= 2;

    const navRailContent = hasNavRail
      ? renderNavRail!({
          document,
          activeChapterIndex,
          archivedSessions: archivedGuidedSessions,
          viewingArchivedId,
          isStreaming,
          onScrollToChapter: scrollToChapter,
          onScrollToStep: scrollToStep,
          onScrollToQuestion: scrollToQuestion,
          onGuideChapter: (href) => void guideChapter(href),
          onOpenSettings: openSettings,
          onViewArchived: (id) => {
            setViewingArchivedId(id);
            void switchSession(id).catch((err) => setInvokeError(String(err)));
          },
          onReturnToCanonical: () => {
            setViewingArchivedId(null);
            if (canonical) {
              void switchSession(canonical.id).catch((err) => setInvokeError(String(err)));
            }
          },
        })
      : null;

    const showEmptyState =
      !document.hasStarted &&
      document.orphanSideThreads.length === 0 &&
      document.pendingSteps.length === 0 &&
      document.incompleteSteps.length === 0 &&
      !error;

    return (
      <CitationContext.Provider value={citationActions}>
        <div
          data-testid="guide-workspace"
          className={cn("relative flex h-full min-h-0 font-chat", !isWorkspace && "bg-card")}
        >
          {hasNavRail && (
            <div
              hidden={!navRailOpen}
              className={
                navRailOpen
                  ? "h-full min-h-0 shrink-0 overflow-hidden"
                  : "h-full w-0 overflow-hidden"
              }
              style={navRailOpen ? { width: railWidth } : undefined}
            >
              {navRailContent}
            </div>
          )}
          {hasNavRail && navRailOpen && (
            <div
              className="absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/30"
              style={{ left: railWidth - 3 }}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("guide.navTitle")}
              onPointerDown={startRailResize}
              onPointerMove={onRailResizeMove}
              onPointerUp={endRailResize}
              onPointerCancel={cancelRailResize}
            />
          )}

          <div
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col",
              isWorkspace
                ? cn(
                    "my-2 mr-1 overflow-hidden rounded-xl bg-background shadow-soft",
                    hasNavRail && navRailOpen ? "ml-1" : "ml-2",
                  )
                : "h-full",
            )}
          >
            {!bookReady && (
              <p className="px-4 py-1.5 text-xs text-muted-foreground" role="status">
                {t("chat.waitingBook")}
              </p>
            )}

            {isViewingArchived && (
              <div
                role="status"
                className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
              >
                <span>{t("guide.archivedBanner")}</span>
                {canonical && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setViewingArchivedId(null);
                      void switchSession(canonical.id).catch((err) => setInvokeError(String(err)));
                    }}
                  >
                    <ArrowLeft className="h-3 w-3" />
                    {t("guide.navArchivedBack")}
                  </Button>
                )}
              </div>
            )}

            {showChapterBar && activeRun && (
              <GuideChapterBar
                document={document}
                activeRun={activeRun}
                activeRunIndex={activeRunIndex}
                isViewingHistory={isViewingHistory}
                compact={!isWorkspace}
                onSelectRun={handleSelectRun}
                onJumpLatest={handleJumpLatest}
                onJumpToHit={handleJumpToHit}
              />
            )}

            <div className="relative min-h-0 flex-1">
              <div
                ref={scroll.scrollContainerRef}
                onScroll={scroll.handleScroll}
                onScrollEnd={scroll.finishJump}
                data-testid="guide-document-scroll"
                className={cn(
                  "chat-message-scroll h-full space-y-6 overflow-y-auto",
                  showOutlineRail ? "py-4 pr-4 pl-12" : "px-4 py-4",
                )}
              >
                {configSnapshot && !configSnapshot.configured && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="flex-1">
                      {t("chat.unconfigured")}
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 h-6 text-xs"
                        onClick={() => setShowConfig(true)}
                      >
                        {t("chat.openSettings")}
                      </Button>
                    </div>
                  </div>
                )}

                {showEmptyState && (
                  <EmptyState
                    hasSelection={pendingSelection != null}
                    bookReady={bookReady}
                    guided
                    onSuggestion={(text) => {
                      setInput(text);
                      inputRef.current?.focus();
                    }}
                  />
                )}

                {(!activeRun || isFirstRun) &&
                  leadingMarkers.map((marker) => (
                    <GuideTimelineDivider key={`lead-${marker.messageIndex}`} marker={marker} />
                  ))}

                {(!activeRun || isFirstRun) && document.orphanSideThreads.length > 0 && (
                  <GuideSideThread
                    threads={document.orphanSideThreads}
                    defaultExpanded
                    expandedQuestionIndex={expandedQuestionIndex}
                    isStreaming={isStreaming}
                    bookReady={bookReady}
                    readOnly={isViewingArchived}
                    editingQaId={editingQa?.id ?? null}
                    editDraft={editDraft}
                    onDraftChange={setEditDraft}
                    onStartEdit={handleStartEditQa}
                    onSaveEdit={() => void handleSaveEdit()}
                    onCancelEdit={handleCancelEdit}
                    onRegenerate={(qa) => void handleRegenerateQa(qa)}
                    onSwitchBranch={(qa, anchorId, dir) => void handleSwitchQaBranch(qa, anchorId, dir)}
                    registerItem={scroll.registerItem}
                  />
                )}

                {(!activeRun || isFirstRun) &&
                  leadingIncompleteSteps.map((attempt) => (
                    <GuideIncompleteStepCard
                      key={attempt.id}
                      node={attempt}
                      defaultExpanded={attempt.id === activeTailIncompleteId}
                      isTail={attempt.id === activeTailIncompleteId}
                      bookReady={bookReady}
                      isStreaming={isStreaming}
                      readOnly={isViewingArchived}
                      availableModels={availableModels}
                      currentModel={activeModel}
                      onRegenerate={(idx) => void handleRegenerate(idx)}
                      onRetryWithModel={(model, idx) => void handleRetryIncompleteWithModel(model, idx)}
                      onDismiss={() => void handleDismissIncompleteTail()}
                      registerItem={scroll.registerItem}
                    />
                  ))}

                {activeRun && (
                  <GuideChapterGroup
                    key={activeRun.id}
                    run={activeRun}
                    isLatestRun={isLatestRun}
                    subsequentRunsCount={Math.max(0, document.runs.length - 1 - activeRunIndex)}
                    markersByAfterStep={markersByAfterStep}
                    incompleteStepsByAfterStep={incompleteStepsByAfterStep}
                    activeTailIncompleteId={activeTailIncompleteId}
                    expandedQuestionIndex={expandedQuestionIndex}
                    bookReady={bookReady}
                    isStreaming={isStreaming}
                    readOnly={isViewingArchived}
                    canOpenStep={Boolean(onOpenQuote)}
                    availableModels={availableModels}
                    currentModel={activeModel}
                    onOpenStep={openGuideStep}
                    loadStepImages={guideStepImages}
                    loadStepImageUrl={readStepImageUrl}
                    onRegenerateMessage={(idx) => void handleRegenerate(idx)}
                    onRetryIncompleteWithModel={(model, idx) =>
                      void handleRetryIncompleteWithModel(model, idx)
                    }
                    onDismissIncompleteTail={() => void handleDismissIncompleteTail()}
                    onReviseStep={(anchorId, opts) => void handleReviseStep(anchorId, opts)}
                    onSelectRevision={(anchorId, revId) => void handleSelectRevision(anchorId, revId)}
                    onUndoLatestStep={() => void handleUndoLatestStep()}
                    onRereadChapter={(run) => void handleRereadChapter(run)}
                    onRollbackChapter={(run) => void handleRollbackChapter(run)}
                    onSwitchBranch={(anchorId, dir) => void handleSwitchBranch(anchorId, dir)}
                    editingQaId={editingQa?.id ?? null}
                    editDraft={editDraft}
                    onDraftChange={setEditDraft}
                    onStartEditQa={handleStartEditQa}
                    onSaveEdit={() => void handleSaveEdit()}
                    onCancelEdit={handleCancelEdit}
                    onRegenerateQa={(qa) => void handleRegenerateQa(qa)}
                    onSwitchQaBranch={(qa, anchorId, dir) => void handleSwitchQaBranch(qa, anchorId, dir)}
                    registerItem={scroll.registerItem}
                    extraActions={extraStepActions}
                  />
                )}

                {(!activeRun || isLatestRun) &&
                  document.pendingSteps.map((pending) => (
                    <GuideStepMarkerPlaceholder key={pending.id} />
                  ))}

                {(!activeRun || isLatestRun) &&
                  !state.activeSideThreadKey &&
                  !state.activeRevisionTarget &&
                  isStreaming &&
                  (!lastChatMessage || lastChatMessage.role === "user") && (
                    <div className="flex gap-2">
                      <TypingIndicator />
                    </div>
                  )}

                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {(!activeRun || isLatestRun) && state.compaction && (
                  <CompactionStatus status={state.compaction.status} />
                )}

                {activeRun && document.runs.length >= 2 && (
                  <GuideChapterFooter
                    prevRun={prevRun}
                    nextRun={nextRun}
                    onSelectRun={handleSelectRun}
                  />
                )}

                <div ref={scroll.endRef} />
              </div>

              {showOutlineRail && (
                <ChatOutlineRail
                  key={`${bookId}:${state.sessionId ?? ""}`}
                  items={outlineItems}
                  activeMessageIndex={scroll.activeIndex}
                  onGoTo={scroll.scrollToItem}
                />
              )}
            </div>

            <GuideControlDock
              nextStep={isGuided ? nextStep : undefined}
              started={guideStarted}
              bookReady={bookReady}
              isStreaming={isStreaming}
              readOnly={isViewingArchived}
              onContinue={handleGuideContinue}
              onSkip={() => void handleGuideSkip()}
              onPick={() => setRangePickerOpen(true)}
              contextStats={guideContextStats ? guideContextStats() : null}
              onResetContext={
                resetGuideContext
                  ? () => {
                      setInvokeError(null);
                      void resetGuideContext().catch((err) => setInvokeError(String(err)));
                    }
                  : undefined
              }
              input={input}
              onInputChange={setInput}
              onSend={() => void handleSendQuestion()}
              onAbort={() => void handleAbort()}
              pendingSelection={pendingSelection}
              onClearSelection={() => setPendingSelection(null)}
              textareaRef={inputRef}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={(level) => void handleThinkingLevelChange(level)}
              progressionExtras={
                <>
                  <Select
                    value={pace}
                    onValueChange={(value) => setPace(value as GuideStepPace)}
                    disabled={isStreaming}
                  >
                    <Tip label={t("guide.paceLabel")}>
                      <SelectTrigger
                        aria-label={t("guide.paceLabel")}
                        className="mt-1 h-7 w-auto gap-1 rounded-full border-border/70 bg-transparent px-2 text-2xs text-muted-foreground shadow-none focus:ring-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                    </Tip>
                    <SelectContent position="popper" side="top" align="end">
                      <SelectItem value="standard">{t("guide.paceStandard")}</SelectItem>
                      <SelectItem value="compact">{t("guide.paceCompact")}</SelectItem>
                      <SelectItem value="deep">{t("guide.paceDeep")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {progressionExtras}
                </>
              }
              leadingControls={
                <ModelSwitcher
                  provider={configSnapshot?.provider ?? null}
                  model={configSnapshot?.model ?? null}
                  configured={configSnapshot?.configured ?? false}
                  customModels={customModels}
                  isStreaming={isStreaming}
                  onModelSelect={(model) => void handleModelSelect(model)}
                  onOpenConfig={() => setShowConfig(true)}
                />
              }
            />

            {isGuided && bookReady && nextStep && !isViewingArchived && (
              <GuideRangePicker
                open={rangePickerOpen}
                onOpenChange={setRangePickerOpen}
                step={nextStep}
                loadOutline={loadGuideOutline}
                onPick={(to) => void handleGuideRangePick(to)}
              />
            )}

            <AgentConfigDialog open={showConfig} onClose={() => setShowConfig(false)} />
            <SessionConfigDialog
              key={configSession?.id ?? "none"}
              open={configSession !== null}
              session={configSession}
              isStreaming={isStreaming}
              onClose={() => setConfigSession(null)}
              onSave={(p) => void handleSaveSessionConfig(p)}
              onRestartGuided={
                restartGuide
                  ? (id) => {
                      setConfigSession(null);
                      setViewingArchivedId(null);
                      setInvokeError(null);
                      void restartGuide(id).catch((err) => setInvokeError(String(err)));
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </CitationContext.Provider>
    );
  },
);
