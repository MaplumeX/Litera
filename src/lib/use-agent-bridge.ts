import { useCallback, useEffect, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { agentReducer, createAgentState } from "@/lib/agent-reducer";
import { registerAgentSubscription } from "@/lib/agent-subscription";
import type { AgentEvent, AgentMessage, AgentSnapshot } from "@/types/agent";

interface CommandReceipt {
  requestId: string;
  promptId?: string;
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useAgentBridge(bookId: string) {
  const [state, dispatch] = useReducer(agentReducer, bookId || null, createAgentState);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const pendingRestoreSessionIdRef = useRef<string | null>(null);
  const pendingEditRef = useRef<{ promptId: string; message: AgentMessage } | null>(null);

  const switchSession = useCallback(async (sessionId: string) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) return;
    const requestId = id("switch-session");
    await invoke<CommandReceipt>("switch_session", {
      bookId: currentBookId,
      sessionId,
      requestId,
    });
  }, []);

  const listSessions = useCallback(async () => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) return;
    const requestId = id("list-sessions");
    dispatch({ type: "session_list_requested", requestId });
    await invoke<CommandReceipt>("list_sessions", { bookId: currentBookId, requestId });
  }, []);

  useEffect(() => {
    const subscription = registerAgentSubscription({
      listen: async (handler) => listen<AgentEvent>("agent_event", (event) => handler(event.payload)),
      getSnapshot: () => invoke<AgentSnapshot>("get_agent_snapshot"),
      onEvent: (event) => {
        dispatch({ type: "event", event });
        const currentBookId = bookIdRef.current;
        if (event.type === "session_rewound" && event.bookId === currentBookId) {
          const pending = pendingEditRef.current;
          if (pending && pending.promptId === event.promptId) {
            pendingEditRef.current = null;
            dispatch({ type: "user_message", message: pending.message });
          }
        }
        if (event.type === "error" && pendingEditRef.current && event.promptId === pendingEditRef.current.promptId) {
          pendingEditRef.current = null;
        }
        if (!currentBookId || !("bookId" in event) || event.bookId !== currentBookId) return;
        if (event.type === "prompt_end" || event.type === "prompt_aborted") {
          void switchSession(event.sessionId).catch((error) => console.error("restore session history error:", error));
          void listSessions().catch((error) => console.error("refresh sessions error:", error));
        } else if (event.type === "book_ready") {
          void listSessions().catch((error) => console.error("book ready sessions error:", error));
          const pendingSessionId = pendingRestoreSessionIdRef.current;
          if (pendingSessionId) {
            pendingRestoreSessionIdRef.current = null;
            void switchSession(pendingSessionId).catch((error) => console.error("restore pending session error:", error));
          }
        }
        // session_created: the reducer optimistically inserts the new session into the list;
        // calling listSessions() here would return a disk list missing the new (not-yet-persisted)
        // session and overwrite the optimistic entry via sessions_list.
      },
      onSnapshot: (snapshot) => {
        dispatch({ type: "hydrate", snapshot });
        const currentBookId = bookIdRef.current;
        if (!currentBookId || snapshot.bookId !== currentBookId || !snapshot.sessionId) return;
        if (snapshot.status === "bookReady") {
          void switchSession(snapshot.sessionId).catch((error) => console.error("hydrate session error:", error));
        } else {
          pendingRestoreSessionIdRef.current = snapshot.sessionId;
        }
      },
      onError: (error) => console.error("agent subscription error:", error),
    });
    return () => subscription.dispose();
  }, [listSessions, switchSession]);

  useEffect(() => {
    dispatch({ type: "book_changed", bookId: bookId || null });
    pendingRestoreSessionIdRef.current = null;
    pendingEditRef.current = null;
  }, [bookId]);

  const prompt = useCallback(async (
    text: string,
    context: { selection?: string; chapterIndex?: number },
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
      await invoke<CommandReceipt>("agent_prompt", {
        prompt: text,
        selection: context.selection ?? null,
        chapterIndex: context.chapterIndex ?? null,
        bookId: currentBookId,
        requestId,
        promptId,
      });
    } catch (error) {
      dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
      throw error;
    }
    return { requestId, promptId };
  }, []);

  const editPrompt = useCallback(async (
    messageIndex: number,
    text: string,
    context: { selection?: string; chapterIndex?: number },
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
      await invoke<CommandReceipt>("agent_edit_prompt", {
        messageIndex,
        prompt: text,
        selection: context.selection ?? null,
        chapterIndex: context.chapterIndex ?? null,
        bookId: currentBookId,
        requestId,
        promptId,
      });
    } catch (error) {
      pendingEditRef.current = null;
      dispatch({ type: "prompt_queue_failed", promptId, message: String(error) });
      throw error;
    }
    return { requestId, promptId };
  }, []);

  const abort = useCallback(async () => {
    const requestId = id("abort");
    await invoke<CommandReceipt>("agent_abort", {
      promptId: state.promptId,
      requestId,
    });
  }, [state.promptId]);

  const newSession = useCallback(async () => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) return;
    await invoke<CommandReceipt>("new_session", {
      bookId: currentBookId,
      requestId: id("new-session"),
    });
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) return;
    await invoke<CommandReceipt>("delete_session", {
      bookId: currentBookId,
      sessionId,
      requestId: id("delete-session"),
    });
  }, []);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) return;
    await invoke<CommandReceipt>("rename_session", {
      bookId: currentBookId,
      sessionId,
      title,
      requestId: id("rename-session"),
    });
  }, []);

  const restart = useCallback(async () => {
    await invoke("restart_sidecar");
  }, []);

  return {
    state,
    prompt,
    editPrompt,
    abort,
    listSessions,
    newSession,
    switchSession,
    deleteSession,
    renameSession,
    restart,
  };
}
