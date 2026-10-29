import { useCallback, useEffect, useReducer, useRef } from "react";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";
import { agentReducer, createAgentState } from "@/lib/agent-reducer";
import type { AgentMessage, GuideRequest, GuideSelection, GuideStep, RecordedGuideStep, SessionKind } from "@/types/agent";

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useAgentBridge(bookId: string) {
  const [state, dispatch] = useReducer(agentReducer, bookId || null, createAgentState);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const pendingEditRef = useRef<{ promptId: string; message: AgentMessage } | null>(null);

  const switchSession = useCallback(async (sessionId: string) => {
    if (!bookIdRef.current) return;
    await embeddedAgentRuntime.switchSession(sessionId, id("switch-session"));
  }, []);

  const listSessions = useCallback(async () => {
    if (!bookIdRef.current) return;
    const requestId = id("list-sessions");
    dispatch({ type: "session_list_requested", requestId });
    await embeddedAgentRuntime.listSessions(requestId);
  }, []);

  useEffect(() => {
    const unsubscribe = embeddedAgentRuntime.subscribe((event) => {
      dispatch({ type: "event", event });
      const currentBookId = bookIdRef.current;
      if ("bookId" in event && event.bookId && event.bookId !== currentBookId) return;
      if (event.type === "session_rewound") {
        const pending = pendingEditRef.current;
        if (pending?.promptId === event.promptId) {
          pendingEditRef.current = null;
          dispatch({ type: "user_message", message: pending.message });
        }
      }
      if (event.type === "error" && pendingEditRef.current?.promptId === event.promptId) {
        pendingEditRef.current = null;
      }
      if (event.type === "prompt_end" || event.type === "prompt_aborted") {
        void embeddedAgentRuntime.switchSession(event.sessionId).catch((error) =>
          console.error("restore session history error:", error));
        void listSessions().catch((error) => console.error("refresh sessions error:", error));
      } else if (event.type === "book_ready") {
        void listSessions().catch((error) => console.error("book ready sessions error:", error));
      }
    });
    queueMicrotask(() => embeddedAgentRuntime.syncBook(bookIdRef.current));
    const onSessionsSynced = () => {
      // The list carries a request id: the reducer drops unrequested lists,
      // which used to hide sessions another device created.
      const requestId = id("list-sessions");
      dispatch({ type: "session_list_requested", requestId });
      void embeddedAgentRuntime.refreshAfterSync(requestId).catch((error) =>
        console.error("refresh synced sessions error:", error));
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

  const prompt = useCallback(async (
    text: string,
    context: { selection?: string; chapterHref?: string; guideRequest?: GuideRequest },
    message: AgentMessage,
  ) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) throw new Error("No book is open");
    if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
    const requestId = id("prompt-request");
    const promptId = id("prompt");
    dispatch({ type: "prompt_queued", bookId: currentBookId, promptId });
    dispatch({ type: "user_message", message });
    try {
      await embeddedAgentRuntime.prompt(text, context, promptId, requestId);
    } catch (error) {
      dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
      throw error;
    }
    return { requestId, promptId };
  }, []);

  const editPrompt = useCallback(async (
    messageIndex: number,
    text: string,
    context: { selection?: string; chapterHref?: string; guideRequest?: GuideRequest },
    message: AgentMessage,
  ) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) throw new Error("No book is open");
    if (statusRef.current !== "bookReady") throw new Error("Book is not ready");
    const requestId = id("edit-prompt-request");
    const promptId = id("prompt");
    dispatch({ type: "prompt_queued", bookId: currentBookId, promptId });
    pendingEditRef.current = { promptId, message };
    try {
      await embeddedAgentRuntime.prompt(text, context, promptId, requestId, messageIndex);
    } catch (error) {
      pendingEditRef.current = null;
      dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
      throw error;
    }
    return { requestId, promptId };
  }, []);

  const abort = useCallback(async () => embeddedAgentRuntime.abort(id("abort")), []);
  const switchBranchAtAnchor = useCallback(async (anchorId: string, direction: -1 | 1) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) throw new Error("No book is open");
    const sessionId = state.sessionId;
    if (!sessionId) throw new Error("No active session");
    await embeddedAgentRuntime.switchBranchAtAnchor(sessionId, anchorId, direction, id("switch-branch"));
  }, [state.sessionId]);
  const newSession = useCallback(async (kind?: SessionKind) => {
    if (bookIdRef.current) await embeddedAgentRuntime.newSession(id("new-session"), kind);
  }, []);
  const nextGuideStep = useCallback(
    (startHref?: string) => embeddedAgentRuntime.nextGuideStep(startHref),
    [],
  );
  const guideStepAfterChapter = useCallback(
    (step: GuideStep) => embeddedAgentRuntime.guideStepAfterChapter(step),
    [],
  );
  const guideSkimStep = useCallback(
    (step: GuideStep) => embeddedAgentRuntime.guideSkimStep(step),
    [],
  );
  const guideOutline = useCallback(
    (step: GuideStep, after?: number) => embeddedAgentRuntime.guideOutline(step, after),
    [],
  );
  const guideStepTo = useCallback(
    (step: GuideStep, to: { chapterIndex: number; block: number }, skim?: boolean) => embeddedAgentRuntime.guideStepTo(step, to, skim),
    [],
  );
  const guideStepToSelection = useCallback(
    (step: GuideStep, selection: GuideSelection) => embeddedAgentRuntime.guideStepToSelection(step, selection),
    [],
  );
  const guideStepAt = useCallback((href: string) => embeddedAgentRuntime.guideStepAt(href), []);
  const guideStepAnchor = useCallback((step: RecordedGuideStep) => embeddedAgentRuntime.guideStepAnchor(step), []);
  const deleteSession = useCallback(async (sessionId: string) => {
    if (bookIdRef.current) await embeddedAgentRuntime.deleteSession(sessionId, id("delete-session"));
  }, []);
  const renameSession = useCallback(async (sessionId: string, title: string) => {
    if (bookIdRef.current) await embeddedAgentRuntime.renameSession(sessionId, title, id("rename-session"));
  }, []);
  const updateSessionConfig = useCallback(async (sessionId: string, systemPrompt: string) => {
    if (bookIdRef.current) {
      await embeddedAgentRuntime.updateSessionConfig(sessionId, systemPrompt, id("update-session-config"));
    }
  }, []);

  const locateQuote = useCallback(
    (chapterIndex: number, quote: string) => embeddedAgentRuntime.locateQuote(chapterIndex, quote),
    [],
  );

  return { state, prompt, editPrompt, abort, listSessions, newSession, nextGuideStep, guideStepAfterChapter, guideSkimStep, guideOutline, guideStepTo, guideStepToSelection, guideStepAt, guideStepAnchor, switchSession, deleteSession, renameSession, updateSessionConfig, switchBranchAtAnchor, locateQuote };
}
