import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AlertCircle, MessagesSquare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useChatBridge } from "@/lib/use-chat-bridge";
import { useCitationActions } from "@/lib/use-citation-actions";
import { useTranscriptScroll } from "@/lib/use-transcript-scroll";
import { useAssistantModelControls } from "@/lib/use-assistant-model-controls";
import type { QuoteLocation } from "@/agent/book/book-content";
import type { GuideBlockTarget } from "@/lib/guide-marks";
import { AgentConfigDialog } from "@/components/AgentConfigDialog";
import { MessageBubble } from "./MessageBubble";
import { BranchSwitcher } from "./BranchSwitcher";
import { AssistantMessage } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import { CitationContext } from "./Citation";
import { ModelSwitcher } from "./ModelSwitcher";
import { EmptyState } from "./EmptyState";
import { SessionConfigDialog, type SessionConfigTarget } from "./SessionConfigDialog";
import { SessionList } from "./SessionList";
import { TypingIndicator } from "./TypingIndicator";
import { CompactionNotice, CompactionStatus } from "./CompactionNotice";
import { HoldHeight } from "./HoldHeight";
import { ChatOutlineRail, userMessagePreview, type ChatOutlineItem } from "./ChatOutlineRail";
import { useT } from "@/lib/i18n";
import {
  clampSessionRailWidth,
  loadSessionRailWidth,
  saveSessionRailWidth,
} from "@/lib/session-rail-width";
import { isTranscriptMarker } from "@/types/agent";
import { chatActivity, type ChatActivity } from "@/lib/chat-activity";

export interface ChatWorkspaceHandle {
  fillInput: (text: string, chapterHref?: string) => void;
  scrollToMessage: (messageIndex: number) => void;
}

export interface ChatWorkspaceProps {
  currentChapterHref?: string;
  onOpenQuote?: (location: QuoteLocation, quote: string, block?: GuideBlockTarget) => void;
  bookId: string;
  variant?: "docked" | "workspace";
  sessionRailOpen?: boolean;
  onActivityChange?: (activity: ChatActivity) => void;
  /** Optional bridge injected when hosted by a parent wrapper. */
  bridge?: ReturnType<typeof useChatBridge>;
  /** Hide canonical Guided sessions from the ordinary Q&A session list. */
  ordinarySessionsOnly?: boolean;
  /** Optional callback to jump into Guide mode when clicking a legacy/guided item. */
  onOpenGuideMode?: () => void;
}

/**
 * Pure multi-session free-form Q&A workspace (zero Guided-reading branches).
 */
export const ChatWorkspace = forwardRef<ChatWorkspaceHandle, ChatWorkspaceProps>(
  function ChatWorkspace(
    {
      currentChapterHref,
      onOpenQuote,
      bookId,
      variant = "docked",
      sessionRailOpen,
      onActivityChange,
      bridge: injectedBridge,
      ordinarySessionsOnly = true,
      onOpenGuideMode,
    },
    ref,
  ) {
    const { t } = useT();
    const internalBridge = useChatBridge(injectedBridge ? "" : bookId);
    const bridge = injectedBridge ?? internalBridge;
    const {
      state,
      abort,
      deleteSession,
      newSession,
      prompt,
      editPrompt,
      regeneratePrompt,
      renameSession,
      switchSession,
      updateSessionConfig,
      switchBranchAtAnchor,
      locateQuote,
    } = bridge;

    const citationActions = useCitationActions(bookId, locateQuote, onOpenQuote);

    const [input, setInput] = useState("");
    const [pendingSelection, setPendingSelection] = useState<{
      text: string;
      chapterHref?: string;
    } | null>(null);
    const [showSessionList, setShowSessionList] = useState(false);
    const isWorkspace = variant === "workspace";
    const railOpen = sessionRailOpen ?? true;
    const [railWidth, setRailWidth] = useState(loadSessionRailWidth);
    const railResizeRef = useRef<{ startX: number; startWidth: number; maxWidth: number } | null>(
      null,
    );
    const [showConfig, setShowConfig] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [invokeError, setInvokeError] = useState<string | null>(null);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const [configSession, setConfigSession] = useState<SessionConfigTarget | null>(null);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const autoSwitchRef = useRef<string | null>(null);

    const {
      configSnapshot,
      thinkingLevel,
      customModels,
      handleModelSelect,
      handleThinkingLevelChange,
    } = useAssistantModelControls(setInvokeError);

    const isStreaming = submitting || state.status === "prompting";
    const bookReady = state.status === "bookReady" || state.status === "prompting";
    const error = invokeError ?? state.error?.message ?? null;

    const visibleSessions = useMemo(
      () =>
        ordinarySessionsOnly
          ? state.sessions.filter((session) => session.kind !== "guided")
          : state.sessions,
      [ordinarySessionsOnly, state.sessions],
    );

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

    const firstUserIndex = state.messages.findIndex((message) => message.role === "user");
    const hasUserMessage = firstUserIndex !== -1;

    const outlineItems = useMemo<ChatOutlineItem[]>(
      () =>
        state.messages.flatMap((message, index) =>
          message.role === "user"
            ? [{ messageIndex: index, preview: userMessagePreview(message.content) }]
            : [],
        ),
      [state.messages],
    );
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

    const showOutlineRail = isWorkspace && outlineItems.length >= 2;

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
    }, [state.sessionId]);

    useEffect(() => {
      if (state.promptId || state.error) setSubmitting(false);
    }, [state.promptId, state.error]);

    useEffect(() => {
      if (state.status !== "bookReady") return;
      const activeIsGuided =
        state.sessionId &&
        state.sessions.find((s) => s.id === state.sessionId)?.kind === "guided";
      if (state.sessionId && !(ordinarySessionsOnly && activeIsGuided)) return;
      if (visibleSessions.length === 0) {
        if (ordinarySessionsOnly && activeIsGuided && !isStreaming) {
          if (autoSwitchRef.current === "__new__") return;
          autoSwitchRef.current = "__new__";
          void newSession().catch((err) => {
            autoSwitchRef.current = null;
            setInvokeError(String(err));
          });
        }
        return;
      }
      const target = visibleSessions[0].id;
      if (autoSwitchRef.current === target) return;
      autoSwitchRef.current = target;
      setInvokeError(null);
      void switchSession(target).catch((err) => {
        autoSwitchRef.current = null;
        setInvokeError(String(err));
      });
    }, [
      isStreaming,
      newSession,
      ordinarySessionsOnly,
      state.sessionId,
      state.sessions,
      state.status,
      switchSession,
      visibleSessions,
    ]);

    const handleSend = useCallback(async () => {
      const text = input.trim();
      if (!text || isStreaming || !bookId) return;
      setEditingIndex(null);
      setEditDraft("");
      const selection = pendingSelection?.text;
      const chapterHref = pendingSelection?.chapterHref ?? currentChapterHref;
      setInput("");
      setPendingSelection(null);
      setInvokeError(null);
      setSubmitting(true);
      scroll.scrollToBottom();
      try {
        await prompt(
          text,
          { selection, chapterHref },
          { role: "user", content: text, selection, chapterHref },
        );
      } catch (err) {
        setInput((current) => (current ? current : text));
        if (selection) {
          setPendingSelection((current) => current ?? { text: selection, chapterHref });
        }
        setInvokeError(String(err));
        setSubmitting(false);
      }
    }, [bookId, currentChapterHref, input, isStreaming, pendingSelection, prompt, scroll]);

    const handleAbort = useCallback(async () => {
      setInvokeError(null);
      try {
        await abort();
      } catch (err) {
        setInvokeError(String(err));
      }
    }, [abort]);

    const handleSuggestion = useCallback((text: string) => {
      setInput(text);
      inputRef.current?.focus();
    }, []);

    const handleStartEdit = useCallback(
      (index: number) => {
        if (isStreaming) return;
        const message = state.messages[index];
        if (!message || message.role !== "user") return;
        setEditingIndex(index);
        setEditDraft(message.content);
      },
      [isStreaming, state.messages],
    );

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
      const { selection, chapterHref } = original;
      const index = editingIndex;
      setEditingIndex(null);
      setInvokeError(null);
      setSubmitting(true);
      scroll.scrollToBottom();
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
    }, [bookId, editDraft, editPrompt, editingIndex, isStreaming, scroll, state.messages]);

    const handleRegenerate = useCallback(
      async (atIndex?: number) => {
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
        setEditingIndex(null);
        setEditDraft("");
        setInvokeError(null);
        setSubmitting(true);
        scroll.scrollToBottom();
        try {
          await regeneratePrompt(targetIndex);
        } catch (err) {
          setInvokeError(String(err));
          setSubmitting(false);
        }
      },
      [bookId, isStreaming, regeneratePrompt, scroll, state.messages],
    );

    const handleSwitchBranch = useCallback(
      async (anchorId: string, direction: -1 | 1) => {
        if (isStreaming) return;
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
      [editingIndex, isStreaming, scroll, switchBranchAtAnchor],
    );

    const handleRenameSave = useCallback(
      async (sessionId: string) => {
        const title = editingTitle.trim();
        if (!title) {
          setEditingSessionId(null);
          return;
        }
        setInvokeError(null);
        try {
          await renameSession(sessionId, title);
          setEditingSessionId(null);
        } catch (err) {
          setInvokeError(String(err));
        }
      },
      [editingTitle, renameSession],
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

    useImperativeHandle(
      ref,
      () => ({
        fillInput,
        scrollToMessage: (messageIndex) => scroll.scrollToItem(messageIndex),
      }),
      [fillInput, scroll],
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

    const sessionList = (
      <SessionList
        layout={isWorkspace ? "rail" : "popover"}
        sessions={visibleSessions}
        activeSessionId={state.sessionId}
        isStreaming={isStreaming}
        editingSessionId={editingSessionId}
        editingTitle={editingTitle}
        hideGuidedEntry={ordinarySessionsOnly}
        onNewSession={() => {
          setInvokeError(null);
          if (!isWorkspace) setShowSessionList(false);
          if (!(state.sessionId && state.messages.length === 0)) {
            void newSession().catch((err) => setInvokeError(String(err)));
          }
          queueMicrotask(() => inputRef.current?.focus());
        }}
        onNewGuided={() => {
          if (onOpenGuideMode) {
            onOpenGuideMode();
            return;
          }
        }}
        onSwitchSession={(id) => {
          setInvokeError(null);
          if (!isWorkspace) setShowSessionList(false);
          void switchSession(id).catch((err) => setInvokeError(String(err)));
        }}
        onStartRename={(id, title) => {
          setEditingSessionId(id);
          setEditingTitle(title);
        }}
        onTitleChange={setEditingTitle}
        onSaveRename={(id) => void handleRenameSave(id)}
        onCancelRename={() => setEditingSessionId(null)}
        onOpenSettings={(session) => {
          if (!isWorkspace) setShowSessionList(false);
          setConfigSession(session);
        }}
        onDeleteSession={(id) => {
          setInvokeError(null);
          void deleteSession(id).catch((err) => setInvokeError(String(err)));
        }}
      />
    );

    return (
      <CitationContext.Provider value={citationActions}>
        <div
          data-testid="chat-panel"
          className={cn("relative flex h-full min-h-0", !isWorkspace && "bg-card")}
        >
          {isWorkspace && (
            <div
              hidden={!railOpen}
              className={
                railOpen
                  ? "h-full min-h-0 shrink-0 overflow-hidden"
                  : "h-full w-0 overflow-hidden"
              }
              style={railOpen ? { width: railWidth } : undefined}
            >
              {sessionList}
            </div>
          )}
          {isWorkspace && railOpen && (
            <div
              className="absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/30"
              style={{ left: railWidth - 3 }}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("chat.resizeSessions")}
              onPointerDown={startRailResize}
              onPointerMove={onRailResizeMove}
              onPointerUp={endRailResize}
              onPointerCancel={cancelRailResize}
            />
          )}
          <div
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col font-chat",
              isWorkspace
                ? cn(
                    "my-2 mr-1 overflow-hidden rounded-xl bg-background shadow-soft",
                    railOpen ? "ml-1" : "ml-2",
                  )
                : "h-full",
            )}
          >
            {!bookReady && (
              <p className="px-4 py-1.5 text-xs text-muted-foreground" role="status">
                {t("chat.waitingBook")}
              </p>
            )}

            <div className="relative min-h-0 flex-1">
              <div
                ref={scroll.scrollContainerRef}
                onScroll={scroll.handleScroll}
                onScrollEnd={scroll.finishJump}
                data-testid="chat-message-scroll"
                className={
                  "chat-message-scroll h-full space-y-4 overflow-y-auto " +
                  (showOutlineRail ? "py-3 pr-3 pl-12" : "p-3")
                }
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
                {state.messages.length === 0 && !error && (
                  <EmptyState
                    hasSelection={pendingSelection != null}
                    bookReady={bookReady}
                    guided={false}
                    onSuggestion={handleSuggestion}
                  />
                )}
                {state.messages.map((message, index) => (
                  <div
                    key={index}
                    ref={(element) => {
                      if (message.role !== "user" && message.role !== "assistant") return;
                      scroll.registerItem(index, element);
                    }}
                    className={
                      cn(
                        message.role === "user" && "scroll-mt-3",
                        index < state.messages.length - 2 && "chat-message-offscreen",
                      ) || undefined
                    }
                    data-user-message-index={message.role === "user" ? index : undefined}
                  >
                    {message.role === "user" &&
                      (() => {
                        const anchorId = state.branchAnchors[index];
                        const info =
                          anchorId !== undefined ? state.branchNavigation[anchorId] : undefined;
                        const branchSwitcher =
                          !info || info.options.length <= 1 || info.activeIndex < 0 ? undefined : (
                            <BranchSwitcher
                              current={info.activeIndex + 1}
                              total={info.options.length}
                              disabled={isStreaming}
                              onPrev={() =>
                                void handleSwitchBranch(
                                  info.options[info.activeIndex - 1].anchorId,
                                  -1,
                                )
                              }
                              onNext={() =>
                                void handleSwitchBranch(
                                  info.options[info.activeIndex + 1].anchorId,
                                  1,
                                )
                              }
                            />
                          );
                        return (
                          <MessageBubble
                            message={message}
                            editing={editingIndex === index}
                            draft={editingIndex === index ? editDraft : message.content}
                            onDraftChange={setEditDraft}
                            onStartEdit={() => handleStartEdit(index)}
                            onSave={() => void handleSaveEdit()}
                            onCancel={handleCancelEdit}
                            editDisabled={isStreaming}
                            branchSwitcher={branchSwitcher}
                          />
                        );
                      })()}
                    {message.role === "assistant" &&
                      (() => {
                        const anchorId = state.branchAnchors[index];
                        const info =
                          anchorId !== undefined ? state.branchNavigation[anchorId] : undefined;
                        const branchSwitcher =
                          !info || info.options.length <= 1 || info.activeIndex < 0 ? undefined : (
                            <BranchSwitcher
                              current={info.activeIndex + 1}
                              total={info.options.length}
                              disabled={isStreaming}
                              onPrev={() =>
                                void handleSwitchBranch(
                                  info.options[info.activeIndex - 1].anchorId,
                                  -1,
                                )
                              }
                              onNext={() =>
                                void handleSwitchBranch(
                                  info.options[info.activeIndex + 1].anchorId,
                                  1,
                                )
                              }
                            />
                          );
                        return (
                          <HoldHeight active={isStreaming && index === lastChatIndex}>
                            <AssistantMessage
                              message={message}
                              messageIndex={index}
                              streaming={isStreaming && index === lastChatIndex}
                              canRegenerate={
                                !isStreaming &&
                                bookReady &&
                                firstUserIndex !== -1 &&
                                index > firstUserIndex
                              }
                              onRegenerate={handleRegenerate}
                              branchSwitcher={branchSwitcher}
                            />
                          </HoldHeight>
                        );
                      })()}
                    {message.role === "notice" && <CompactionNotice notice={message} />}
                  </div>
                ))}
                {isStreaming && (!lastChatMessage || lastChatMessage.role === "user") && (
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
                {state.compaction && <CompactionStatus status={state.compaction.status} />}
                {(!lastChatMessage || lastChatMessage.role === "user") &&
                  !isStreaming &&
                  bookReady &&
                  hasUserMessage && (
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

            <ChatInput
              value={input}
              onChange={setInput}
              onSend={() => void handleSend()}
              onAbort={() => void handleAbort()}
              isStreaming={isStreaming}
              bookReady={bookReady}
              pendingSelection={pendingSelection}
              onClearSelection={() => setPendingSelection(null)}
              textareaRef={inputRef}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={(level) => void handleThinkingLevelChange(level)}
              leadingControls={
                <>
                  {!isWorkspace && (
                    <Popover
                      open={showSessionList}
                      onOpenChange={setShowSessionList}
                      modal={false}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                          disabled={!bookId}
                          aria-label={t("chat.sessions")}
                        >
                          <MessagesSquare />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align="start"
                        collisionPadding={8}
                        className="w-80 max-w-(--radix-popover-content-available-width) overflow-hidden p-0"
                        onCloseAutoFocus={(event) => {
                          if (document.activeElement === inputRef.current) event.preventDefault();
                        }}
                      >
                        {sessionList}
                      </PopoverContent>
                    </Popover>
                  )}
                  <ModelSwitcher
                    provider={configSnapshot?.provider ?? null}
                    model={configSnapshot?.model ?? null}
                    configured={configSnapshot?.configured ?? false}
                    customModels={customModels}
                    isStreaming={isStreaming}
                    onModelSelect={(model) => void handleModelSelect(model)}
                    onOpenConfig={() => setShowConfig(true)}
                  />
                </>
              }
            />
            <AgentConfigDialog open={showConfig} onClose={() => setShowConfig(false)} />
            <SessionConfigDialog
              key={configSession?.id ?? "none"}
              open={configSession !== null}
              session={configSession}
              isStreaming={isStreaming}
              onClose={() => setConfigSession(null)}
              onSave={(p) => void handleSaveSessionConfig(p)}
            />
          </div>
        </div>
      </CitationContext.Provider>
    );
  },
);
