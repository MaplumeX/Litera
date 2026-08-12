import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { MessagesSquare, Settings, RefreshCw, AlertCircle } from "lucide-react";
import { useAgentBridge } from "@/lib/use-agent-bridge";
import { useAgentConfig } from "@/lib/use-agent-config";
import { AgentConfigDialog } from "@/components/AgentConfigDialog";
import type { AgentMessage } from "@/types/agent";
import { MessageBubble } from "./MessageBubble";
import { AssistantMessage, BotAvatar } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import { SessionList } from "./SessionList";
import { TypingIndicator } from "./TypingIndicator";

export interface ChatPanelHandle {
  fillInput: (text: string, chapterIndex: number) => void;
}

interface ChatPanelProps {
  currentChapterIndex: number;
  bookId: string;
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel({ currentChapterIndex, bookId }, ref) {
    const bridge = useAgentBridge(bookId);
    const { state } = bridge;
    const {
      abort,
      deleteSession,
      newSession,
      prompt,
      renameSession,
      restart,
      switchSession,
    } = bridge;
    const [input, setInput] = useState("");
    const [pendingSelection, setPendingSelection] = useState<{
      text: string;
      chapterIndex: number;
    } | null>(null);
    const [showSessionList, setShowSessionList] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [invokeError, setInvokeError] = useState<string | null>(null);
    const [retryHighlight, setRetryHighlight] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const { snapshot: configSnapshot, load: loadConfig } = useAgentConfig();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const autoSwitchRef = useRef<string | null>(null);
    const lastSentRef = useRef<{ text: string; selection?: string; chapterIndex: number } | null>(null);
    const abortedRef = useRef(false);

    const isStreaming = submitting || state.status === "prompting";
    const bookReady = state.status === "bookReady" || state.status === "prompting";
    const error = invokeError ?? state.error?.message ?? null;
    const lastMessage = state.messages[state.messages.length - 1];

    useEffect(() => {
      void loadConfig();
    }, [loadConfig]);

    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [state.messages]);

    useEffect(() => {
      setShowSessionList(false);
      setInvokeError(null);
      setSubmitting(false);
      autoSwitchRef.current = null;
    }, [bookId]);

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
        setPendingSelection({ text: last.selection, chapterIndex: last.chapterIndex });
      }
      setRetryHighlight(true);
      const timer = setTimeout(() => setRetryHighlight(false), 2000);
      return () => clearTimeout(timer);
    }, [state.status]);

    const handleSend = useCallback(async () => {
      const text = input.trim();
      if (!text || isStreaming || !bookId) return;
      const selection = pendingSelection?.text;
      const chapterIndex = pendingSelection?.chapterIndex ?? currentChapterIndex;
      lastSentRef.current = { text, selection, chapterIndex };
      setInput("");
      setPendingSelection(null);
      setInvokeError(null);
      setSubmitting(true);
      try {
        await prompt(
          text,
          { selection, chapterIndex },
          { role: "user", content: text, selection, chapterIndex },
        );
      } catch (error) {
        setInvokeError(String(error));
        setSubmitting(false);
      }
    }, [bookId, currentChapterIndex, input, isStreaming, pendingSelection, prompt]);

    const handleAbort = useCallback(async () => {
      setInvokeError(null);
      abortedRef.current = true;
      try {
        await abort();
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [abort]);

    const handleRestart = useCallback(async () => {
      setInvokeError(null);
      try {
        await restart();
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [restart]);

    const handleSuggestion = useCallback((text: string) => {
      setInput(text);
      inputRef.current?.focus();
    }, []);

    const handleEdit = useCallback((message: AgentMessage) => {
      setInput(message.content);
      if (message.selection) {
        setPendingSelection({
          text: message.selection,
          chapterIndex: message.chapterIndex ?? currentChapterIndex,
        });
      } else {
        setPendingSelection(null);
      }
      inputRef.current?.focus();
    }, [currentChapterIndex]);

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

    const fillInput = useCallback((text: string, chapterIndex: number) => {
      setPendingSelection({ text, chapterIndex });
      setInput("");
      inputRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ fillInput }), [fillInput]);

    return (
      <div className="relative flex h-full flex-col bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setShowSessionList((value) => !value)}
              disabled={!bookId}
              aria-label="会话列表"
            >
              <MessagesSquare />
            </Button>
            <h2 className="text-sm font-semibold">阅读助手</h2>
          </div>
          {state.status === "restarting" ? (
            <span className="text-xs text-amber-600">正在恢复…</span>
          ) : state.status === "unavailable" ? (
            <div className="flex items-center gap-2">
              <Button size="icon-xs" variant="outline" onClick={() => void handleRestart()} aria-label="重启助手">
                <RefreshCw />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setShowConfig(true)}
                aria-label="设置"
              >
                <Settings />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {bookReady ? "已就绪" : "等待书籍…"}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setShowConfig(true)}
                aria-label="设置"
              >
                <Settings />
              </Button>
            </div>
          )}
        </div>

        {showSessionList && (
          <SessionList
            sessions={state.sessions}
            activeSessionId={state.sessionId}
            isStreaming={isStreaming}
            editingSessionId={editingSessionId}
            editingTitle={editingTitle}
            onClose={() => setShowSessionList(false)}
            onNewSession={() => {
              setInvokeError(null);
              void newSession().catch((error) => setInvokeError(String(error)));
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
        )}

        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          {configSnapshot && !configSnapshot.configured && (
            <div className="flex items-start gap-2 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                未配置 LLM provider，请先打开设置。
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-2 h-6 text-xs"
                  onClick={() => setShowConfig(true)}
                >
                  打开设置
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
                <MessageBubble message={message} onEdit={handleEdit} />
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
    );
  },
);
