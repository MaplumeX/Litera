import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
  const [subscribed, setSubscribed] = useState(false);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;

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
        if (!currentBookId || !("bookId" in event) || event.bookId !== currentBookId) return;
        if (event.type === "prompt_end" || event.type === "prompt_aborted") {
          void switchSession(event.sessionId).catch((error) => console.error("restore session history error:", error));
          void listSessions().catch((error) => console.error("refresh sessions error:", error));
        } else if (event.type === "book_ready") {
          void listSessions().catch((error) => console.error("book ready sessions error:", error));
        }
        // session_created: the reducer optimistically inserts the new session into the list;
        // calling listSessions() here would return a disk list missing the new (not-yet-persisted)
        // session and overwrite the optimistic entry via sessions_list.
      },
      onRegistered: () => setSubscribed(true),
      onSnapshot: (snapshot) => {
        dispatch({ type: "hydrate", snapshot });
        const currentBookId = bookIdRef.current;
        if (currentBookId && snapshot.bookId === currentBookId && snapshot.sessionId && snapshot.status === "bookReady") {
          void switchSession(snapshot.sessionId).catch((error) => console.error("hydrate session error:", error));
        }
      },
      onError: (error) => console.error("agent subscription error:", error),
    });
    return () => subscription.dispose();
  }, [listSessions, switchSession]);

  useEffect(() => {
    dispatch({ type: "book_changed", bookId: bookId || null });
    if (subscribed && bookId) {
      void invoke<AgentSnapshot>("get_agent_snapshot")
        .then((snapshot) => dispatch({ type: "hydrate", snapshot }))
        .catch((error) => console.error("book snapshot hydration error:", error));
      void listSessions().catch((error) => console.error("list_sessions error:", error));
    }
  }, [bookId, listSessions, subscribed]);

  const prompt = useCallback(async (
    text: string,
    context: { selection?: string; chapterIndex?: number },
    message: AgentMessage,
  ) => {
    const currentBookId = bookIdRef.current;
    if (!currentBookId) throw new Error("No book is open");
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
    abort,
    listSessions,
    newSession,
    switchSession,
    deleteSession,
    renameSession,
    restart,
  };
}
