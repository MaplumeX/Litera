import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// --- Types ------------------------------------------------------------------

interface ToolCall {
  tool: string;
  params: unknown;
  result?: unknown;
  done: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Selected text quoted in the user message (user messages only). */
  selection?: string;
  /** Chapter index context (user messages only). */
  chapterIndex?: number;
  /** Tool calls made during this assistant message. */
  toolCalls?: ToolCall[];
}

interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A serialized message from session history (matches sidecar SerializedMessage). */
interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { tool: string; params: unknown; result?: unknown; done: boolean }[];
}

export interface ChatPanelHandle {
  /** Fill the input with selected text and focus it. */
  fillInput: (text: string, chapterIndex: number) => void;
}

interface ChatPanelProps {
  /** Current chapter index (for prompt context when no selection). */
  currentChapterIndex: number;
  /** Current book id (empty when no book open). */
  bookId: string;
}

// --- ToolCallCard component --------------------------------------------------

function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const paramsStr = call.params && typeof call.params === "object"
    ? Object.entries(call.params as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(", ")
    : String(call.params ?? "");
  return (
    <div className="rounded border bg-muted/50 text-xs">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-muted/70"
      >
        <span className="text-muted-foreground">{expanded ? "▼" : "▶"}</span>
        <span className="font-medium">🔧 {call.tool}</span>
        <span className="truncate text-muted-foreground">({paramsStr})</span>
      </button>
      {expanded && call.result != null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t px-2 py-1 text-xs text-muted-foreground">
          {typeof call.result === "string"
            ? call.result
            : JSON.stringify(call.result, null, 2)}
        </pre>
      )}
    </div>
  );
}

// --- ChatPanel component ----------------------------------------------------

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel({ currentChapterIndex, bookId }, ref) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [pendingSelection, setPendingSelection] = useState<{
      text: string;
      chapterIndex: number;
    } | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [bookReady, setBookReady] = useState(false);
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [showSessionList, setShowSessionList] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const bookIdRef = useRef(bookId);
    bookIdRef.current = bookId;

    // Listen to agent events from Rust (sidecar stdout → Tauri events).
    useEffect(() => {
      const unlisteners: UnlistenFn[] = [];

      (async () => {
        unlisteners.push(
          await listen<{ delta: string }>("agent_text_delta", (event) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: last.content + event.payload.delta },
                ];
              }
              return [...prev, { role: "assistant", content: event.payload.delta }];
            });
            setIsStreaming(true);
          }),
        );

        unlisteners.push(
          await listen<{ tool: string; params: unknown }>("agent_tool_start", (event) => {
            const { tool, params } = event.payload;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              const newCall: ToolCall = { tool, params, done: false };
              if (last && last.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  { ...last, toolCalls: [...(last.toolCalls ?? []), newCall] },
                ];
              }
              return [...prev, { role: "assistant", content: "", toolCalls: [newCall] }];
            });
          }),
        );

        unlisteners.push(
          await listen<{ result: unknown }>("agent_tool_end", (event) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== "assistant" || !last.toolCalls) return prev;
              const toolCalls = [...last.toolCalls];
              const idx = toolCalls.findIndex((t) => !t.done);
              if (idx === -1) return prev;
              toolCalls[idx] = { ...toolCalls[idx], result: event.payload.result, done: true };
              return [...prev.slice(0, -1), { ...last, toolCalls }];
            });
          }),
        );

        unlisteners.push(
          await listen("agent_end", () => {
            setIsStreaming(false);
          }),
        );

        unlisteners.push(
          await listen<{ message: string }>("agent_error", (event) => {
            setError(event.payload.message);
            setIsStreaming(false);
          }),
        );

        unlisteners.push(
          await listen("agent_ready", () => {
            setError(null);
          }),
        );

        unlisteners.push(
          await listen("agent_book_ready", () => {
            setBookReady(true);
          }),
        );

        // --- Session management events ---

        unlisteners.push(
          await listen<{ sessionId: string }>("session_created", (event) => {
            setCurrentSessionId(event.payload.sessionId);
            setShowSessionList(false);
            // Refresh the session list to include the new session.
            if (bookIdRef.current) {
              void invoke("list_sessions", { bookId: bookIdRef.current }).catch(() => {});
            }
          }),
        );

        unlisteners.push(
          await listen<{ sessionId: string; messages: HistoryMessage[] }>(
            "session_switched",
            (event) => {
              const { sessionId, messages: history } = event.payload;
              setCurrentSessionId(sessionId);
              setError(null);
              setIsStreaming(false);
              // Replace current messages with the session history.
              setMessages(
                history.map((m) => ({
                  role: m.role,
                  content: m.content,
                  toolCalls: m.toolCalls?.map((tc) => ({
                    tool: tc.tool,
                    params: tc.params,
                    result: tc.result,
                    done: tc.done,
                  })),
                })),
              );
              setShowSessionList(false);
            },
          ),
        );

        unlisteners.push(
          await listen<{ sessionId: string }>("session_deleted", (event) => {
            const deletedId = event.payload.sessionId;
            setCurrentSessionId((prev) => {
              if (prev === deletedId) {
                setMessages([]);
                return null;
              }
              return prev;
            });
            // Refresh the session list.
            if (bookIdRef.current) {
              void invoke("list_sessions", { bookId: bookIdRef.current }).catch(() => {});
            }
          }),
        );

        unlisteners.push(
          await listen<{ sessions: SessionSummary[] }>("sessions_list", (event) => {
            const list = event.payload.sessions;
            setSessions(list);
            // If no session is active yet, auto-switch to the most recently updated session.
            setCurrentSessionId((prev) => {
              if (prev) return prev;
              if (list.length > 0) {
                // list is sorted by updatedAt desc from sidecar (SessionManager.list sorts by modified desc)
                const target = list[0];
                void invoke("switch_session", { sessionId: target.id }).catch(() => {});
                return target.id;
              }
              return prev;
            });
          }),
        );
      })();

      return () => {
        unlisteners.forEach((fn) => fn());
      };
    }, []);

    // Auto-scroll to bottom on new content.
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Reset session state when switching books.
    useEffect(() => {
      setSessions([]);
      setCurrentSessionId(null);
      setMessages([]);
      setError(null);
      setBookReady(false);
      setShowSessionList(false);
      // If a book is open, request the session list from the sidecar.
      if (bookId) {
        void invoke("list_sessions", { bookId }).catch((err) => {
          console.error("list_sessions error:", err);
        });
      }
    }, [bookId]);

    const handleSend = useCallback(async () => {
      const text = input.trim();
      if (!text || isStreaming) return;
      const selection = pendingSelection?.text;
      const chapterIndex = pendingSelection?.chapterIndex ?? currentChapterIndex;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, selection, chapterIndex },
      ]);
      setInput("");
      setPendingSelection(null);
      setError(null);
      setIsStreaming(true);

      try {
        await invoke("agent_prompt", {
          prompt: text,
          selection: selection ?? null,
          chapterIndex: chapterIndex,
        });
      } catch (err) {
        setError(String(err));
        setIsStreaming(false);
      }
    }, [input, isStreaming, pendingSelection, currentChapterIndex]);

    const handleAbort = useCallback(async () => {
      try {
        await invoke("agent_abort");
      } catch (err) {
        setError(String(err));
      }
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void handleSend();
        }
      },
      [handleSend],
    );

    /** Fill input with selected text (called from ReaderView selection capture). */
    const fillInput = useCallback((text: string, chapterIndex: number) => {
      setPendingSelection({ text, chapterIndex });
      setInput("");
      inputRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ fillInput }), [fillInput]);

    // --- Session list actions ---

    const handleNewSession = useCallback(async () => {
      if (!bookId) return;
      try {
        await invoke("new_session", { bookId });
      } catch (err) {
        setError(String(err));
      }
    }, [bookId]);

    const handleSwitchSession = useCallback(async (sessionId: string) => {
      try {
        await invoke("switch_session", { sessionId });
      } catch (err) {
        setError(String(err));
      }
    }, []);

    const handleDeleteSession = useCallback(
      async (sessionId: string) => {
        try {
          await invoke("delete_session", { sessionId });
        } catch (err) {
          setError(String(err));
        }
      },
      [],
    );

    return (
      <div className="relative flex h-full flex-col bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setShowSessionList((v) => !v)}
              disabled={!bookId}
            >
              ☰ 会话
            </Button>
            <h2 className="text-sm font-semibold">阅读助手</h2>
          </div>
          {bookReady ? (
            <span className="text-xs text-muted-foreground">📖 已就绪</span>
          ) : (
            <span className="text-xs text-muted-foreground">等待书籍…</span>
          )}
        </div>

        {/* Session list overlay (covers the messages area) */}
        {showSessionList && (
          <div className="absolute inset-x-0 top-[37px] bottom-0 z-10 flex flex-col bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">会话列表</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setShowSessionList(false)}
              >
                ✕
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                onClick={() => void handleNewSession()}
              >
                + 新建会话
              </Button>
              {sessions.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  暂无会话，点击「新建会话」开始。
                </p>
              )}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-muted/70",
                    currentSessionId === s.id && "bg-muted",
                  )}
                >
                  <button
                    className="flex-1 truncate text-left"
                    onClick={() => void handleSwitchSession(s.id)}
                    title={s.title}
                  >
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.updatedAt).toLocaleString()}
                    </div>
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-destructive hover:underline px-1 text-xs"
                    onClick={() => void handleDeleteSession(s.id)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && !error && (
            <div className="text-center text-sm text-muted-foreground mt-8">
              打开一本书，选中段落或直接提问。
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className="space-y-1">
              {/* User message */}
              {msg.role === "user" && (
                <div className="space-y-1">
                  {msg.selection && (
                    <div className="border-l-4 border-primary/60 bg-muted px-3 py-1 text-sm italic text-muted-foreground">
                      &ldquo;{msg.selection}&rdquo;
                    </div>
                  )}
                  <div className="rounded-lg bg-primary/10 px-3 py-2 text-sm">
                    {msg.content}
                  </div>
                </div>
              )}

              {/* Assistant message */}
              {msg.role === "assistant" && (
                <div className="space-y-1">
                  {msg.toolCalls?.map((call, j) => (
                    <ToolCallCard key={j} call={call} />
                  ))}
                  {msg.content && (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
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

        {/* Pending selection indicator */}
        {pendingSelection && (
          <div className="border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
            引用选段：&ldquo;{pendingSelection.text.slice(0, 60)}{pendingSelection.text.length > 60 ? "…" : ""}&rdquo;
            <button
              onClick={() => setPendingSelection(null)}
              className="ml-2 text-destructive hover:underline"
            >
              ✕
            </button>
          </div>
        )}

        {/* Input */}
        <div className="border-t p-2">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              className={cn(
                "flex-1 resize-none rounded border bg-background px-2 py-1 text-sm",
                "focus:outline-none focus:ring-1 focus:ring-ring",
              )}
              rows={2}
              placeholder="输入问题…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
            />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            {isStreaming && (
              <Button size="sm" variant="outline" onClick={() => void handleAbort()}>
                停止
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => void handleSend()}
              disabled={!input.trim() || isStreaming}
            >
              发送
            </Button>
          </div>
        </div>
      </div>
    );
  },
);