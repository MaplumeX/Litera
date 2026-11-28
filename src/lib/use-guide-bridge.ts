import { useCallback, useEffect, useReducer, useRef } from "react";
import { guideController } from "@/agent/runtime/guide-controller";
import { sideThreadKeyFor } from "@/agent/sessions/pi-session";
import { agentReducer, createAgentState } from "@/lib/agent-reducer";
import type {
  ActiveStepRevisionTarget,
  AgentMessage,
  GuideRequest,
  GuideSelection,
  GuideStep,
  GuideStepOptions,
  RecordedGuideStep,
  StepRevisionOptions,
} from "@/types/agent";

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Dedicated React bridge for `GuideWorkspace` backed by `guideController`.
 */
export function useGuideBridge(bookId: string) {
  const [state, dispatch] = useReducer(agentReducer, bookId || null, createAgentState);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const pendingEditRef = useRef<{ promptId: string; message: AgentMessage; sideThreadKey?: string } | null>(null);

  const listSessions = useCallback(async () => {
    if (!bookIdRef.current) return;
    const requestId = id("guide-list-sessions");
    dispatch({ type: "session_list_requested", requestId });
    await guideController.listSessions(requestId);
  }, []);

  useEffect(() => {
    const unsubscribe = guideController.subscribe((event) => {
      dispatch({ type: "event", event });
      const currentBookId = bookIdRef.current;
      if ("bookId" in event && event.bookId && event.bookId !== currentBookId) return;
      if (event.type === "session_rewound") {
        const pending = pendingEditRef.current;
        if (pending?.promptId === event.promptId) {
          pendingEditRef.current = null;
          dispatch({ type: "user_message", message: pending.message, sideThreadKey: pending.sideThreadKey ?? event.sideThreadKey });
        }
      }
      if (
        (event.type === "prompt_started" || event.type === "prompt_end" || event.type === "prompt_aborted" || event.type === "error") &&
        pendingEditRef.current?.promptId === event.promptId
      ) {
        pendingEditRef.current = null;
      }
      if (event.type === "prompt_end" || event.type === "prompt_aborted") {
        if (event.messages === undefined) {
          void guideController.switchSession(event.sessionId).catch((error) =>
            console.error("restore guide session error:", error),
          );
        }
        void listSessions().catch((error) => console.error("refresh guide sessions error:", error));
      } else if (event.type === "book_ready") {
        void listSessions().catch((error) => console.error("guide book ready sessions error:", error));
      }
    });
    queueMicrotask(() => guideController.syncBook(bookIdRef.current));
    const onSessionsSynced = () => {
      const requestId = id("guide-list-sessions");
      dispatch({ type: "session_list_requested", requestId });
      void guideController
        .refreshAfterSync(requestId)
        .catch((error) => console.error("refresh synced guide sessions error:", error));
    };
    window.addEventListener("litera:sessions-synced", onSessionsSynced);
    return () => {
      unsubscribe();
      window.removeEventListener("litera:sessions-synced", onSessionsSynced);
    };
  }, [listSessions]);

  useEffect(() => {
    dispatch({ type: "book_changed", bookId: bookId || null });
    pendingEditRef.current = null;
  }, [bookId]);

  const ensureCanonicalGuide = useCallback(async () => {
    if (!bookIdRef.current) return null;
    return guideController.ensureCanonicalGuide(id("ensure-guide"));
  }, []);

  const switchSession = useCallback(async (sessionId: string) => {
    if (!bookIdRef.current) return;
    await guideController.switchSession(sessionId, id("switch-guide"));
  }, []);

  const newGuidedSession = useCallback(async () => {
    if (!bookIdRef.current) return;
    await guideController.newGuidedSession(id("new-guide"));
  }, []);

  const takeStep = useCallback(
    async (label: string, request: GuideRequest, options?: GuideStepOptions) => {
      const currentBookId = bookIdRef.current;
      if (!currentBookId) throw new Error("No book is open");
      if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
      const requestId = id("guide-step-req");
      const promptId = id("prompt");
      const merged: GuideRequest = {
        ...request,
        ...(options?.pace && options.pace !== "standard" ? { pace: options.pace } : {}),
        ...(options?.styleOverride?.trim() ? { styleOverride: options.styleOverride.trim() } : {}),
      };
      const message: AgentMessage = { role: "user", content: label, guideRequest: merged };
      dispatch({ type: "prompt_queued", bookId: currentBookId, promptId });
      dispatch({ type: "user_message", message });
      // If the runtime auto-rewinds a trailing incomplete attempt before persisting,
      // `session_rewound` will restore this optimistic user message onto the clean spine.
      pendingEditRef.current = { promptId, message };
      try {
        await guideController.takeStep(label, request, options, promptId, requestId);
      } catch (error) {
        if (pendingEditRef.current?.promptId === promptId) pendingEditRef.current = null;
        dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
        throw error;
      }
      return { requestId, promptId };
    },
    [],
  );

  const askSideQuestion = useCallback(
    async (
      text: string,
      context: { selection?: string; chapterHref?: string; sideThreadAnchorId?: string | null },
    ) => {
      const currentBookId = bookIdRef.current;
      if (!currentBookId) throw new Error("No book is open");
      if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
      const requestId = id("guide-ask-req");
      const promptId = id("prompt");
      const sideThreadKey =
        context.sideThreadAnchorId !== undefined
          ? sideThreadKeyFor(context.sideThreadAnchorId)
          : undefined;
      const message: AgentMessage = {
        role: "user",
        content: text,
        selection: context.selection,
        chapterHref: context.chapterHref,
      };
      dispatch({ type: "prompt_queued", bookId: currentBookId, promptId, sideThreadKey });
      if (sideThreadKey !== undefined) {
        dispatch({ type: "user_message", message, sideThreadKey });
      }
      try {
        await guideController.askSideQuestion(text, context, promptId, requestId);
      } catch (error) {
        dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
        throw error;
      }
      return { requestId, promptId };
    },
    [],
  );

  const editSideTurn = useCallback(
    async (
      anchorId: string | null,
      messageIndex: number,
      text: string,
      context: { selection?: string; chapterHref?: string },
      message: AgentMessage,
    ) => {
      const currentBookId = bookIdRef.current;
      if (!currentBookId) throw new Error("No book is open");
      if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
      const requestId = id("guide-side-edit-req");
      const promptId = id("prompt");
      const sideThreadKey = sideThreadKeyFor(anchorId);
      dispatch({ type: "prompt_queued", bookId: currentBookId, promptId, sideThreadKey });
      pendingEditRef.current = { promptId, message, sideThreadKey };
      try {
        await guideController.askSideQuestion(
          text,
          { ...context, sideThreadAnchorId: anchorId },
          promptId,
          requestId,
          messageIndex,
        );
      } catch (error) {
        pendingEditRef.current = null;
        dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
        throw error;
      }
      return { requestId, promptId };
    },
    [],
  );

  const regenerateSideTurn = useCallback(async (anchorId: string | null, messageIndex: number) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) throw new Error("No book is open");
    if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
    const requestId = id("guide-side-regen-req");
    const promptId = id("prompt");
    const sideThreadKey = sideThreadKeyFor(anchorId);
    dispatch({ type: "prompt_queued", bookId: currentBookId, promptId, sideThreadKey });
    try {
      await guideController.regenerateSideTurn(anchorId, messageIndex, promptId, requestId);
    } catch (error) {
      dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
      throw error;
    }
    return { requestId, promptId };
  }, []);

  const editTurn = useCallback(
    async (
      messageIndex: number,
      text: string,
      context: { selection?: string; chapterHref?: string; guideRequest?: GuideRequest },
      message: AgentMessage,
    ) => {
      const currentBookId = bookIdRef.current;
      if (!currentBookId) throw new Error("No book is open");
      if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
      const requestId = id("guide-edit-req");
      const promptId = id("prompt");
      dispatch({ type: "prompt_queued", bookId: currentBookId, promptId });
      pendingEditRef.current = { promptId, message };
      try {
        if (context.guideRequest) {
          await guideController.takeStep(
            text,
            context.guideRequest,
            undefined,
            promptId,
            requestId,
            messageIndex,
          );
        } else {
          await guideController.editLegacySpineTurn(text, context, promptId, requestId, messageIndex);
        }
      } catch (error) {
        pendingEditRef.current = null;
        dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
        throw error;
      }
      return { requestId, promptId };
    },
    [],
  );

  const regenerateTurn = useCallback(async (messageIndex: number) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) throw new Error("No book is open");
    if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
    const requestId = id("guide-regenerate-req");
    const promptId = id("prompt");
    dispatch({ type: "prompt_queued", bookId: currentBookId, promptId });
    try {
      await guideController.regenerateTurn(messageIndex, promptId, requestId);
    } catch (error) {
      dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
      throw error;
    }
    return { requestId, promptId };
  }, []);

  const reviseStep = useCallback(
    async (targetAnchorId: string, options?: StepRevisionOptions) => {
      const currentBookId = bookIdRef.current;
      if (!currentBookId) throw new Error("No book is open");
      if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
      const requestId = id("guide-revise-req");
      const promptId = id("prompt");
      const revisionId = id("rev");
      const stepRevisionTarget: ActiveStepRevisionTarget = {
        targetAnchorId,
        revisionId,
        ...(options?.pace ? { pace: options.pace } : {}),
        ...(options?.styleOverride?.trim() ? { styleOverride: options.styleOverride.trim() } : {}),
        ...(options?.modelOverride?.trim() ? { modelId: options.modelOverride.trim() } : {}),
      };
      dispatch({ type: "prompt_queued", bookId: currentBookId, promptId, stepRevisionTarget });
      try {
        await guideController.reviseStep(targetAnchorId, options, promptId, requestId, revisionId);
      } catch (error) {
        dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
        throw error;
      }
      return { requestId, promptId, revisionId };
    },
    [],
  );

  const selectStepRevision = useCallback(
    async (targetAnchorId: string, revisionId: string) => {
      if (!bookIdRef.current || !state.sessionId) return;
      await guideController.selectStepRevision(
        state.sessionId,
        targetAnchorId,
        revisionId,
        id("select-step-revision"),
      );
    },
    [state.sessionId],
  );

  const undoLatestStep = useCallback(async () => {
    if (!bookIdRef.current || !state.sessionId) return;
    await guideController.undoLatestStep(state.sessionId, id("undo-latest-step"));
  }, [state.sessionId]);

  const dismissIncompleteTail = useCallback(async () => {
    if (!bookIdRef.current || !state.sessionId) return;
    await guideController.dismissIncompleteTail(state.sessionId, id("dismiss-incomplete-tail"));
  }, [state.sessionId]);

  const rollbackToChapterRun = useCallback(
    async (runAnchorEntryId: string) => {
      if (!bookIdRef.current || !state.sessionId) return;
      await guideController.rollbackToChapterRun(
        state.sessionId,
        runAnchorEntryId,
        id("rollback-chapter"),
      );
    },
    [state.sessionId],
  );

  const abort = useCallback(async () => guideController.abort(id("abort")), []);
  const switchBranchAtAnchor = useCallback(
    async (anchorId: string, direction: -1 | 1) => {
      if (!bookIdRef.current || !state.sessionId) return;
      await guideController.switchBranchAtAnchor(state.sessionId, anchorId, direction, id("switch-branch"));
    },
    [state.sessionId],
  );
  const switchSideBranchAtAnchor = useCallback(
    async (sideThreadKey: string, anchorEntryId: string, direction: -1 | 1) => {
      if (!bookIdRef.current || !state.sessionId) return;
      await guideController.switchSideBranchAtAnchor(
        state.sessionId,
        sideThreadKey,
        anchorEntryId,
        direction,
        id("switch-side-branch"),
      );
    },
    [state.sessionId],
  );
  const restartGuide = useCallback(async (sessionId: string) => {
    if (bookIdRef.current) await guideController.restartGuide(sessionId, id("restart-guide"));
  }, []);
  const restoreGuide = useCallback(async (sessionId: string) => {
    if (!bookIdRef.current) return;
    await guideController.restoreGuide(sessionId, id("restore-guide"));
    await listSessions();
  }, [listSessions]);
  const renameSession = useCallback(async (sessionId: string, title: string) => {
    if (bookIdRef.current) await guideController.renameSession(sessionId, title, id("rename-guide"));
  }, []);
  const deleteSession = useCallback(async (sessionId: string) => {
    if (bookIdRef.current) await guideController.deleteSession(sessionId, id("delete-guide"));
  }, []);
  const loadGuideSession = useCallback(async (sessionId: string) => {
    if (!bookIdRef.current) return null;
    return guideController.loadGuideSession(bookIdRef.current, sessionId);
  }, []);
  const updateConfig = useCallback(async (sessionId: string, systemPrompt: string) => {
    if (bookIdRef.current) {
      await guideController.updateConfig(sessionId, systemPrompt, id("update-guide-config"));
    }
  }, []);
  const resetContext = useCallback(async () => {
    if (bookIdRef.current) await guideController.resetContext();
  }, []);
  const contextStats = useCallback(() => guideController.contextStats(), []);
  const nextStep = useCallback((startHref?: string) => guideController.nextStep(startHref), []);
  const stepAfterChapter = useCallback((step: GuideStep) => guideController.stepAfterChapter(step), []);
  const stepAtHref = useCallback((href: string) => guideController.stepAtHref(href), []);
  const outline = useCallback((step: GuideStep, after?: number) => guideController.outline(step, after), []);
  const stepTo = useCallback(
    (step: GuideStep, to: { chapterIndex: number; block: number }) =>
      guideController.stepTo(step, to),
    [],
  );
  const stepToSelection = useCallback(
    (step: GuideStep, selection: GuideSelection) => guideController.stepToSelection(step, selection),
    [],
  );
  const stepAnchor = useCallback((step: RecordedGuideStep) => guideController.stepAnchor(step), []);
  const stepImages = useCallback((step: RecordedGuideStep) => guideController.stepImages(step), []);
  const readStepImageUrl = useCallback((src: string) => guideController.readStepImageUrl(src), []);
  const locateQuote = useCallback(
    (chapterIndex: number, quote: string) => guideController.locateQuote(chapterIndex, quote),
    [],
  );

  return {
    state,
    ensureCanonicalGuide,
    switchSession,
    newGuidedSession,
    takeStep,
    askSideQuestion,
    editTurn,
    editSideTurn,
    regenerateTurn,
    regenerateSideTurn,
    reviseStep,
    selectStepRevision,
    undoLatestStep,
    dismissIncompleteTail,
    rollbackToChapterRun,
    abort,
    switchBranchAtAnchor,
    switchSideBranchAtAnchor,
    restartGuide,
    restoreGuide,
    renameSession,
    deleteSession,
    loadGuideSession,
    updateConfig,
    resetContext,
    contextStats,
    nextStep,
    stepAfterChapter,
    stepAtHref,
    outline,
    stepTo,
    stepToSelection,
    stepAnchor,
    stepImages,
    readStepImageUrl,
    locateQuote,
  };
}
