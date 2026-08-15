import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { MessagesSquare, Settings, AlertCircle } from "lucide-react";
import { useAgentBridge } from "@/lib/use-agent-bridge";
import { useAgentConfig } from "@/lib/use-agent-config";
import { AgentConfigDialog } from "@/components/AgentConfigDialog";
import { MessageBubble } from "./MessageBubble";
import { AssistantMessage, BotAvatar } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import { SessionList } from "./SessionList";
import { TypingIndicator } from "./TypingIndicator";
import { useT } from "@/lib/i18n";

export interface ChatPanelHandle {
  fillInput: (text: string, chapterHref?: string) => void;
}

interface ChatPanelProps {
  currentChapterHref?: string;
  bookId: string;
  variant?: "docked" | "workspace";
  sessionRailOpen?: boolean;
  onSessionRailOpenChange?: (open: boolean) => void;
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel(
    {
      currentChapterHref,
      bookId,
      variant = "docked",
      sessionRailOpen,
      onSessionRailOpenChange,
    },
    ref,
  ) {
    const { t } = useT();
    const bridge = useAgentBridge(bookId);
    const { state } = bridge;
    const {
      abort,
      deleteSession,
      newSession,
      prompt,
      editPrompt,
      renameSession,
      switchSession,
    } = bridge;
    const [input, setInput] = useState("");
    const [pendingSelection, setPendingSelection] = useState<{
      text: string;
      chapterHref?: string;
    } | null>(null);
    const [showSessionList, setShowSessionList] = useState(false);
    const [internalRailOpen, setInternalRailOpen] = useState(true);
    const isWorkspace = variant === "workspace";
    const railOpen = sessionRailOpen ?? internalRailOpen;
    const setRailOpen = onSessionRailOpenChange ?? setInternalRailOpen;
    const [showConfig, setShowConfig] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [invokeError, setInvokeError] = useState<string | null>(null);
    const [retryHighlight, setRetryHighlight] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const [stickToBottom, setStickToBottom] = useState(true);
    const { snapshot: configSnapshot, load: loadConfig } = useAgentConfig();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const autoSwitchRef = useRef<string | null>(null);
    const lastSentRef = useRef<{ text: string; selection?: string; chapterHref?: string } | null>(null);
    const abortedRef = useRef(false);

    const isStreaming = submitting || state.status === "prompting";
    const bookReady = state.status === "bookReady" || state.status === "prompting";
    const error = invokeError ?? state.error?.message ?? null;
    const lastMessage = state.messages[state.messages.length - 1];

    const scrollToBottom = useCallback(() => {
      setStickToBottom(true);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    const handleScroll = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setStickToBottom(distanceFromBottom < 48);
    }, []);

    useEffect(() => {
      void loadConfig();
    }, [loadConfig]);

    useEffect(() => {
      if (stickToBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }, [state.messages, stickToBottom]);

    useEffect(() => {
      setShowSessionList(false);
      setInvokeError(null);
      setSubmitting(false);
      setEditingIndex(null);
      setEditDraft("");
      autoSwitchRef.current = null;
    }, [bookId]);

    useEffect(() => {
      if (isWorkspace) setShowSessionList(false);
    }, [isWorkspace]);

    useEffect(() => {
      setEditingIndex(null);
      setEditDraft("");
      scrollToBottom();
    }, [state.sessionId, scrollToBottom]);

    useEffect(() => {
      if (state.promptId || state.error) setSubmitting(false);
    }, [state.promptId, state.error]);

    useEffect(() => {
      if (state.status !== "bookReady" || state.sessionId || state.sessions.length === 0) return;
      const target = state.sessions[0].id;
      if (autoSwitchRef.current === target) return;
      autoSwitchRef.current = target;
      setInvokeError(null);
      void switchSession(target).catch((error) => {
        autoSwitchRef.current = null;
        setInvokeError(String(error));
      });
    }, [state.sessionId, state.sessions, state.status, switchSession]);

    useEffect(() => {
      if (!abortedRef.current || state.status !== "bookReady") return;
      const last = lastSentRef.current;
      if (!last) return;
      abortedRef.current = false;
      setInput(last.text);
      if (last.selection) {
        setPendingSelection({ text: last.selection, chapterHref: last.chapterHref });
      }
      setRetryHighlight(true);
      const timer = setTimeout(() => setRetryHighlight(false), 2000);
      return () => clearTimeout(timer);
    }, [state.status]);

    const handleSend = useCallback(async () => {
      const text = input.trim();
      if (!text || isStreaming || !bookId) return;
      setEditingIndex(null);
      setEditDraft("");
      const selection = pendingSelection?.text;
      const chapterHref = pendingSelection?.chapterHref ?? currentChapterHref;
      lastSentRef.current = { text, selection, chapterHref };
      setInput("");
      setPendingSelection(null);
      setInvokeError(null);
      setSubmitting(true);
      scrollToBottom();
      try {
        await prompt(
          text,
          { selection, chapterHref },
          { role: "user", content: text, selection, chapterHref },
        );
      } catch (error) {
        setInvokeError(String(error));
        setSubmitting(false);
      }
    }, [bookId, currentChapterHref, input, isStreaming, pendingSelection, prompt, scrollToBottom]);

    const handleAbort = useCallback(async () => {
      setInvokeError(null);
      abortedRef.current = true;
      try {
        await abort();
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [abort]);

    const handleSuggestion = useCallback((text: string) => {
      setInput(text);
      inputRef.current?.focus();
    }, []);

    const handleStartEdit = useCallback((index: number) => {
      if (isStreaming) return;
      const message = state.messages[index];
      if (!message || message.role !== "user") return;
      setEditingIndex(index);
      setEditDraft(message.content);
    }, [isStreaming, state.messages]);

    const handleCancelEdit = useCallback(() => {
      setEditingIndex(null);
      setEditDraft("");
    }, []);

    const handleSaveEdit = useCallback(async () => {
      if (editingIndex === null) return;
      const text = editDraft.trim();
      if (!text || isStreaming || !bookId) return;
      const original = state.messages[editingIndex];
      if (!original || original.role !== "user") return;
      const selection = original.selection;
      const chapterHref = original.chapterHref;
      lastSentRef.current = {
        text,
        selection,
        chapterHref: chapterHref ?? currentChapterHref,
      };
      const index = editingIndex;
      setEditingIndex(null);
      setInvokeError(null);
      setSubmitting(true);
      scrollToBottom();
      try {
        await editPrompt(
          index,
          text,
          { selection, chapterHref },
          { role: "user", content: text, selection, chapterHref },
        );
        setEditDraft("");
      } catch (error) {
        setInvokeError(String(error));
        setSubmitting(false);
        setEditingIndex(index);
      }
    }, [bookId, currentChapterHref, editDraft, editPrompt, editingIndex, isStreaming, scrollToBottom, state.messages]);

    const handleRenameSave = useCallback(async (sessionId: string) => {
      const title = editingTitle.trim();
      if (!title) {
        setEditingSessionId(null);
        return;
      }
      setInvokeError(null);
      try {
        await renameSession(sessionId, title);
        setEditingSessionId(null);
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [editingTitle, renameSession]);

    const fillInput = useCallback((text: string, chapterHref?: string) => {
      setPendingSelection({ text, chapterHref });
      setInput("");
      inputRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ fillInput }), [fillInput]);

    const sessionList = (
      <SessionList
        layout={isWorkspace ? "rail" : "overlay"}
        sessions={state.sessions}
        activeSessionId={state.sessionId}
        isStreaming={isStreaming}
        editingSessionId={editingSessionId}
        editingTitle={editingTitle}
        onClose={() => setShowSessionList(false)}
        onNewSession={() => {
          setInvokeError(null);
          if (!isWorkspace) setShowSessionList(false);
          if (!(state.sessionId && state.messages.length === 0)) {
            void newSession().catch((error) => setInvokeError(String(error)));
          }
          queueMicrotask(() => inputRef.current?.focus());
        }}
        onSwitchSession={(id) => {
          setInvokeError(null);
          void switchSession(id).catch((error) => setInvokeError(String(error)));
        }}
        onStartRename={(id, title) => {
          setEditingSessionId(id);
          setEditingTitle(title);
        }}
        onTitleChange={setEditingTitle}
        onSaveRename={(id) => void handleRenameSave(id)}
        onCancelRename={() => setEditingSessionId(null)}
        onDeleteSession={(id) => {
          setInvokeError(null);
          void deleteSession(id).catch((error) => setInvokeError(String(error)));
        }}
      />
    );

    return (
      <div data-testid="chat-panel" className="relative flex h-full min-h-0 bg-card">
        {isWorkspace && (
          <div
            hidden={!railOpen}
            className={
              railOpen
                ? "h-full min-h-0 shrink-0 overflow-hidden border-r"
                : "h-full w-0 overflow-hidden"
            }
          >
            {sessionList}
          </div>
        )}
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon-xs"
              variant={isWorkspace && railOpen ? "secondary" : "ghost"}
              onClick={() => {
                if (isWorkspace) setRailOpen(!railOpen);
                else setShowSessionList((value) => !value);
              }}
              disabled={!bookId}
              aria-label={t("chat.sessions")}
            >
              <MessagesSquare />
            </Button>
            <h2 className="text-sm font-semibold">{t("chat.title")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {bookReady ? t("chat.ready") : t("chat.waitingBook")}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setShowConfig(true)}
              aria-label={t("chat.settings")}
            >
              <Settings />
            </Button>
          </div>
        </div>

        {!isWorkspace && showSessionList && sessionList}

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 space-y-4 overflow-y-auto p-3"
        >
          {configSnapshot && !configSnapshot.configured && (
            <div className="flex items-start gap-2 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
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
          {state.messages.length === 0 && !error && (
            <EmptyState
              hasSelection={pendingSelection != null}
              bookReady={bookReady}
              onSuggestion={handleSuggestion}
            />
          )}
          {state.messages.map((message, index) => (
            <div key={index}>
              {message.role === "user" && (
                <MessageBubble
                  message={message}
                  editing={editingIndex === index}
                  draft={editingIndex === index ? editDraft : message.content}
                  onDraftChange={setEditDraft}
                  onStartEdit={() => handleStartEdit(index)}
                  onSave={() => void handleSaveEdit()}
                  onCancel={handleCancelEdit}
                  editDisabled={isStreaming}
                />
              )}
              {message.role === "assistant" && (
                <AssistantMessage
                  message={message}
                  streaming={isStreaming && index === state.messages.length - 1}
                />
              )}
            </div>
          ))}
          {isStreaming && (!lastMessage || lastMessage.role === "user") && (
            <div className="flex gap-2">
              <BotAvatar />
              <TypingIndicator />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput
          value={input}
          onChange={setInput}
          onSend={() => void handleSend()}
          onAbort={() => void handleAbort()}
          isStreaming={isStreaming}
          bookReady={bookReady}
          pendingSelection={pendingSelection}
          onClearSelection={() => setPendingSelection(null)}
          retryHighlight={retryHighlight}
          textareaRef={inputRef}
        />
        <AgentConfigDialog open={showConfig} onClose={() => setShowConfig(false)} />
        </div>
      </div>
    );
  },
);
