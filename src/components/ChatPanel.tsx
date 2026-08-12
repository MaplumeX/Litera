import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { MessagesSquare, Settings, RefreshCw, Copy, Check, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentBridge } from "@/lib/use-agent-bridge";
import { useAgentConfig } from "@/lib/use-agent-config";
import { AgentConfigDialog } from "@/components/AgentConfigDialog";
import type { AgentMessage, AgentToolCall } from "@/types/agent";

export interface ChatPanelHandle {
  fillInput: (text: string, chapterIndex: number) => void;
}

interface ChatPanelProps {
  currentChapterIndex: number;
  bookId: string;
}

function ToolCallCard({ call }: { call: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const paramsStr = call.params && typeof call.params === "object"
    ? Object.entries(call.params as Record<string, unknown>)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(", ")
    : String(call.params ?? "");
  return (
    <div className="rounded border bg-muted/50 text-xs">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-muted/70"
      >
        <span className="text-muted-foreground">{expanded ? "▼" : "▶"}</span>
        <span className="font-medium">🔧 {call.tool}</span>
        <span className="truncate text-muted-foreground">({paramsStr})</span>
      </button>
      {expanded && call.result != null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t px-2 py-1 text-xs text-muted-foreground">
          {typeof call.result === "string" ? call.result : JSON.stringify(call.result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
      aria-label="复制"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
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
    const { snapshot: configSnapshot, load: loadConfig } = useAgentConfig();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const autoSwitchRef = useRef<string | null>(null);
    const lastSentRef = useRef<{ text: string; selection?: string; chapterIndex: number } | null>(null);
    const abortedRef = useRef(false);

    const isStreaming = submitting || state.status === "prompting";
    const bookReady = state.status === "bookReady" || state.status === "prompting";
    const error = invokeError ?? state.error?.message ?? null;

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

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    }, [handleSend]);

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
          <div className="absolute inset-x-0 top-[37px] bottom-0 z-10 flex flex-col bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">会话列表</span>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowSessionList(false)}>
                ✕
              </Button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setInvokeError(null);
                  void newSession().catch((error) => setInvokeError(String(error)));
                }}
                disabled={isStreaming}
              >
                + 新建会话
              </Button>
              {state.sessions.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  暂无会话，可直接提问或新建会话。
                </p>
              )}
              {state.sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    "group flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-muted/70",
                    state.sessionId === session.id && "bg-muted",
                  )}
                >
                  <button
                    className="flex-1 truncate text-left disabled:opacity-50"
                    onClick={() => {
                      setInvokeError(null);
                      void switchSession(session.id).catch((error) => setInvokeError(String(error)));
                    }}
                    title={session.title}
                    disabled={isStreaming}
                  >
                    <div className="truncate font-medium">{session.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(session.updatedAt).toLocaleString()}
                    </div>
                  </button>
                  <button
                    className="px-1 text-xs text-destructive opacity-0 hover:underline disabled:opacity-30 group-hover:opacity-100"
                    onClick={() => {
                      setInvokeError(null);
                      void deleteSession(session.id).catch((error) => setInvokeError(String(error)));
                    }}
                    disabled={isStreaming}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {configSnapshot && !configSnapshot.configured && (
            <div className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
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
          )}
          {state.messages.length === 0 && !error && (
            <div className="mt-8 text-center text-sm text-muted-foreground">
              打开一本书，选中段落或直接提问。
            </div>
          )}
          {state.messages.map((message, index) => (
            <div key={index} className="space-y-1">
              {message.role === "user" && (
                <div className="group space-y-1">
                  {message.selection && (
                    <div className="border-l-4 border-primary/60 bg-muted px-3 py-1 text-sm italic text-muted-foreground">
                      &ldquo;{message.selection}&rdquo;
                    </div>
                  )}
                  <div className="relative rounded-lg bg-primary/10 px-3 py-2 text-sm">
                    {message.content}
                    <button
                      onClick={() => handleEdit(message)}
                      className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="编辑"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              )}
              {message.role === "assistant" && (
                <div className="space-y-1">
                  {message.toolCalls?.map((call) => <ToolCallCard key={call.toolCallId} call={call} />)}
                  {message.content && (
                    <div className="group relative">
                      <CopyButton text={message.content} />
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {error && (
            <div className="rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              ⚠ {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {pendingSelection && (
          <div className="border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
            引用选段：&ldquo;{pendingSelection.text.slice(0, 60)}{pendingSelection.text.length > 60 ? "…" : ""}&rdquo;
            <button onClick={() => setPendingSelection(null)} className="ml-2 text-destructive hover:underline">✕</button>
          </div>
        )}

        <div className="border-t p-2">
          <textarea
            ref={inputRef}
            className={cn(
              "w-full resize-none rounded border bg-background px-2 py-1 text-sm",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              retryHighlight && "ring-2 ring-primary",
            )}
            rows={2}
            placeholder="输入问题…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming || !bookReady}
          />
          <div className="mt-1 flex justify-end gap-2">
            {isStreaming && (
              <Button size="sm" variant="outline" onClick={() => void handleAbort()}>停止</Button>
            )}
            <Button size="sm" onClick={() => void handleSend()} disabled={!input.trim() || isStreaming || !bookReady}>
              发送
            </Button>
          </div>
        </div>
        <AgentConfigDialog open={showConfig} onClose={() => setShowConfig(false)} />
      </div>
    );
  },
);
