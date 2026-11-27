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
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
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
import { canonicalGuidedSession } from "@/agent/sessions/pi-session";
import type { GuideBlockTarget } from "@/lib/guide-marks";
import {
  findRunIdForChapter,
  findRunIdForMessage,
  findRunIdForStep,
  findSideQuestionUserIndex,
  projectGuideDocument,
  resolveActiveGuideRun,
  type GuideDocument,
  type GuideIncompleteStepNode,
  type GuideSearchHit,
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
} from "@/types/agent";

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
      regenerateTurn,
      switchSession,
      updateConfig: updateSessionConfig,
      switchBranchAtAnchor,
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
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
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
          isStreaming,
        }),
      [
        bookId,
        isGuided,
        isStreaming,
        state.branchAnchors,
        state.branchNavigation,
        state.messages,
        state.sessionId,
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

    const activity = chatActivity(state.messages, isStreaming);
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
          for (const qa of step.sideThreads) {
            items.push({
              messageIndex: qa.userMessageIndex,
              preview: userMessagePreview(qa.question),
              kind: "question",
            });
          }
        }
      }
      return items;
    }, [activeRun, document.orphanSideThreads, isFirstRun]);

    const trackedIndices = useMemo(
      () => outlineItems.map((item) => item.messageIndex),
      [outlineItems],
    );

    const scroll = useTranscriptScroll({
      bookId,
      sessionId: state.sessionId,
      isStreaming,
      contentKey: state.messages,
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
      setEditingIndex(null);
      setEditDraft("");
      setExpandedQuestionIndex(null);
      setFocusedRunId(null);
      setViewingArchivedId(null);
      pendingJumpRef.current = null;
      autoInitRef.current = null;
    }, [bookId]);

    useEffect(() => {
      setEditingIndex(null);
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
        setEditingIndex(null);
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
      setEditingIndex(null);
      setEditDraft("");
      const selection = pendingSelection?.text;
      const chapterHref = pendingSelection?.chapterHref ?? currentChapterHref;
      setInput("");
      setPendingSelection(null);
      setInvokeError(null);
      setSubmitting(true);
      focusRun(null, { kind: "bottom", smooth: true });
      try {
        await askSideQuestion(text, { selection, chapterHref });
      } catch (err) {
        setInput((current) => (current ? current : text));
        if (selection) {
          setPendingSelection((current) => current ?? { text: selection, chapterHref });
        }
        setInvokeError(String(err));
        setSubmitting(false);
      }
    }, [askSideQuestion, bookId, currentChapterHref, focusRun, input, isStreaming, isViewingArchived, pendingSelection]);

    const handleAbort = useCallback(async () => {
      setInvokeError(null);
      try {
        await abort();
      } catch (err) {
        setInvokeError(String(err));
      }
    }, [abort]);

    const handleStartEdit = useCallback(
      (index: number) => {
        if (isStreaming || isViewingArchived) return;
        const message = state.messages[index];
        if (!message || message.role !== "user" || message.guide || message.guideRequest) return;
        setEditingIndex(index);
        setEditDraft(message.content);
      },
      [isStreaming, isViewingArchived, state.messages],
    );

    const handleCancelEdit = useCallback(() => {
      setEditingIndex(null);
      setEditDraft("");
    }, []);

    const handleSaveEdit = useCallback(async () => {
      if (editingIndex === null || isViewingArchived) return;
      const text = editDraft.trim();
      if (!text || isStreaming || !bookId) return;
      const original = state.messages[editingIndex];
      if (!original || original.role !== "user") return;
      const { selection, chapterHref } = original;
      const index = editingIndex;
      setEditingIndex(null);
      setInvokeError(null);
      setSubmitting(true);
      focusRun(null, { kind: "bottom", smooth: true });
      try {
        await editPrompt(
          index,
          text,
          { selection, chapterHref },
          { role: "user", content: text, selection, chapterHref },
        );
        setEditDraft("");
      } catch (err) {
        setInvokeError(String(err));
        setSubmitting(false);
        setEditingIndex(index);
      }
    }, [bookId, editDraft, editPrompt, editingIndex, focusRun, isStreaming, isViewingArchived, state.messages]);

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
        const guideRequest =
          rawReq && transformGuideRequest ? transformGuideRequest(rawReq) : rawReq;
        setEditingIndex(null);
        setEditDraft("");
        setInvokeError(null);
        setSubmitting(true);
        focusRun(null, { kind: "bottom", smooth: true });
        try {
          const legacyGuide = Boolean(original.guide && !original.guideRequest);
          const requestChanged =
            Boolean(rawReq && transformGuideRequest) &&
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

    const handleSwitchBranch = useCallback(
      async (anchorId: string, direction: -1 | 1) => {
        if (isStreaming || isViewingArchived) return;
        if (editingIndex !== null) {
          setEditingIndex(null);
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
      [editingIndex, isStreaming, isViewingArchived, scroll, switchBranchAtAnchor],
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
    const latestStepIndex = document.steps.length - 1;

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
                    editingIndex={editingIndex}
                    editDraft={editDraft}
                    onDraftChange={setEditDraft}
                    onStartEdit={handleStartEdit}
                    onSaveEdit={() => void handleSaveEdit()}
                    onCancelEdit={handleCancelEdit}
                    onRegenerate={(idx) => void handleRegenerate(idx)}
                    onSwitchBranch={(anchorId, dir) => void handleSwitchBranch(anchorId, dir)}
                    registerItem={scroll.registerItem}
                  />
                )}

                {(!activeRun || isFirstRun) &&
                  leadingIncompleteSteps.map((attempt) => (
                    <GuideIncompleteStepCard
                      key={attempt.id}
                      node={attempt}
                      defaultExpanded={attempt.id === activeTailIncompleteId}
                      bookReady={bookReady}
                      isStreaming={isStreaming}
                      readOnly={isViewingArchived}
                      onRegenerate={(idx) => void handleRegenerate(idx)}
                      onSwitchBranch={(anchorId, dir) => void handleSwitchBranch(anchorId, dir)}
                      registerItem={scroll.registerItem}
                    />
                  ))}

                {activeRun && (
                  <GuideChapterGroup
                    key={activeRun.id}
                    run={activeRun}
                    latestStepIndex={latestStepIndex}
                    markersByAfterStep={markersByAfterStep}
                    incompleteStepsByAfterStep={incompleteStepsByAfterStep}
                    activeTailIncompleteId={activeTailIncompleteId}
                    expandedQuestionIndex={expandedQuestionIndex}
                    bookReady={bookReady}
                    isStreaming={isStreaming}
                    readOnly={isViewingArchived}
                    canOpenStep={Boolean(onOpenQuote)}
                    onOpenStep={openGuideStep}
                    loadStepImages={guideStepImages}
                    loadStepImageUrl={readStepImageUrl}
                    onRegenerateMessage={(idx) => void handleRegenerate(idx)}
                    onSwitchBranch={(anchorId, dir) => void handleSwitchBranch(anchorId, dir)}
                    editingIndex={editingIndex}
                    editDraft={editDraft}
                    onDraftChange={setEditDraft}
                    onStartEdit={handleStartEdit}
                    onSaveEdit={() => void handleSaveEdit()}
                    onCancelEdit={handleCancelEdit}
                    registerItem={scroll.registerItem}
                    extraActions={extraStepActions}
                  />
                )}

                {(!activeRun || isLatestRun) &&
                  document.pendingSteps.map((pending) => (
                    <GuideStepMarkerPlaceholder key={pending.id} />
                  ))}

                {(!activeRun || isLatestRun) &&
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

                {(!activeRun || isLatestRun) &&
                  (!lastChatMessage ||
                    (lastChatMessage.role === "user" && !lastChatMessage.guideRequest)) &&
                  !isStreaming &&
                  bookReady &&
                  !isViewingArchived &&
                  state.messages.some((m) => m.role === "user") && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => void handleRegenerate()}
                        className="text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                        aria-label={t("chat.regenerate")}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
