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
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MessagesSquare, AlertCircle, RefreshCw } from "lucide-react";
import { useAgentBridge } from "@/lib/use-agent-bridge";
import { useAgentConfig } from "@/lib/use-agent-config";
import { invokeErrorMessage } from "@/lib/app-error";
import type { QuoteLocation } from "@/agent/book/book-content";
import { CHATGPT_PROVIDER_ID, isCustomProviderId } from "@/types/agent-config";
import { AgentConfigDialog } from "@/components/AgentConfigDialog";
import { MessageBubble } from "./MessageBubble";
import { BranchSwitcher } from "./BranchSwitcher";
import { AssistantMessage, BotAvatar } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import { CitationContext, type CitationActions } from "./Citation";
import { ModelSwitcher } from "./ModelSwitcher";
import { EmptyState } from "./EmptyState";
import { GuideBar, guideStepLabel } from "./GuideBar";
import { SessionConfigDialog, type SessionConfigTarget } from "./SessionConfigDialog";
import { SessionList } from "./SessionList";
import { TypingIndicator } from "./TypingIndicator";
import { CompactionNotice, CompactionStatus } from "./CompactionNotice";
import { GuideRecap } from "./GuideRecap";
import { ChatOutlineRail, userMessagePreview } from "./ChatOutlineRail";
import { useT } from "@/lib/i18n";
import {
  clampSessionRailWidth,
  loadSessionRailWidth,
  saveSessionRailWidth,
} from "@/lib/session-rail-width";
import { isTranscriptMarker, type GuideStep } from "@/types/agent";
import { chatActivity, type ChatActivity } from "@/lib/chat-activity";

export interface ChatPanelHandle {
  fillInput: (text: string, chapterHref?: string) => void;
}

interface ChatPanelProps {
  currentChapterHref?: string;
  /** Agent mode: the chapter picked from the TOC as the discussion scope. */
  chapterScope?: { label: string; href?: string } | null;
  onClearChapterScope?: () => void;
  /** Reveal a Citation's passage in the Book pane. */
  onOpenQuote?: (location: QuoteLocation, quote: string) => void;
  bookId: string;
  variant?: "docked" | "workspace";
  /** A Guided session's steps on the active branch, oldest first; null outside one. */
  onGuideStepsChange?: (steps: GuideStep[] | null) => void;
  /** Agent mode: on open, resume the latest Guided session if there is one. */
  preferGuidedSession?: boolean;
  /** Workspace variant: whether the session rail shows. The host owns the
   * toggle (the reader titlebar); defaults to open. */
  sessionRailOpen?: boolean;
  /** Called when the answer starts, ends, or its opening changes. */
  onActivityChange?: (activity: ChatActivity) => void;
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel(
    {
      currentChapterHref,
      chapterScope,
      onClearChapterScope,
      onOpenQuote,
      bookId,
      variant = "docked",
      sessionRailOpen,
      preferGuidedSession = false,
      onGuideStepsChange,
      onActivityChange,
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
      nextGuideStep,
      guideStepAfterChapter,
      guideStepAt,
      prompt,
      editPrompt,
      renameSession,
      switchSession,
      updateSessionConfig,
      switchBranchAtAnchor,
      locateQuote,
    } = bridge;
    // Citation checks are cached per open Book: re-renders and repeated
    // quotes in a Session never hit the book worker twice.
    const citationActions = useMemo<CitationActions>(() => {
      if (!locateQuote) return { openInBook: onOpenQuote };
      const cache = new Map<string, Promise<QuoteLocation>>();
      return {
        locate: (chapterIndex, quote) => {
          const key = `${bookId}\u0000${chapterIndex}\u0000${quote}`;
          let pending = cache.get(key);
          if (!pending) {
            pending = locateQuote(chapterIndex, quote);
            cache.set(key, pending);
            pending.catch(() => cache.delete(key));
          }
          return pending;
        },
        openInBook: onOpenQuote,
      };
    }, [bookId, locateQuote, onOpenQuote]);
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
    const [stickToBottom, setStickToBottom] = useState(true);
    const [activeUserMessageIndex, setActiveUserMessageIndex] = useState<number | null>(null);
    const { snapshot: configSnapshot, load: loadConfig, switchProvider, setThinkingLevel } = useAgentConfig();
    const thinkingLevel = configSnapshot?.thinkingLevel ?? "medium";
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const userMessageRefs = useRef(new Map<number, HTMLDivElement>());
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const suspendBottomFollowRef = useRef(false);
    const messageTocJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoSwitchRef = useRef<string | null>(null);

    const isStreaming = submitting || state.status === "prompting";
    const bookReady = state.status === "bookReady" || state.status === "prompting";
    const error = invokeError ?? state.error?.message ?? null;
    // Notices and recaps are transcript markers, not chat turns: the
    // regenerate/streaming affordances key off the last real chat message.
    let lastChatIndex = -1;
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      if (!isTranscriptMarker(state.messages[i])) { lastChatIndex = i; break; }
    }
    const lastChatMessage = lastChatIndex >= 0 ? state.messages[lastChatIndex] : undefined;
    // The preview stops changing once the answer outgrows it, so a long
    // answer reports a handful of times, not once per token.
    const activity = chatActivity(state.messages, isStreaming);
    useEffect(() => {
      onActivityChange?.({ answering: activity.answering, preview: activity.preview, failed: activity.failed });
    }, [onActivityChange, activity.answering, activity.preview, activity.failed]);
    const userMessageTocItems = state.messages.flatMap((message, index) =>
      message.role === "user"
        ? [{ messageIndex: index, preview: userMessagePreview(message.content) }]
        : [],
    );
    const hasUserMessage = userMessageTocItems.length > 0;
    const isGuided = state.sessions.find((session) => session.id === state.sessionId)?.kind === "guided";
    const guideStarted = state.messages.some((message) => message.role === "user" && !!message.guide);
    // Undefined until the runtime has worked it out; null at the end of the Book.
    const [computedStep, setComputedStep] = useState<GuideStep | null | undefined>(undefined);
    // A step the reader picked (skipping a chapter) instead of the computed
    // one. Nothing is persisted until it is sent: the sent step records where
    // the guide is.
    const [pickedStep, setPickedStep] = useState<GuideStep | null | undefined>(undefined);
    const nextStep = pickedStep !== undefined ? pickedStep : computedStep;
    const showOutlineRail = isWorkspace && userMessageTocItems.length >= 2;

    const clearMessageTocJumpTimer = useCallback(() => {
      if (messageTocJumpTimerRef.current === null) return;
      clearTimeout(messageTocJumpTimerRef.current);
      messageTocJumpTimerRef.current = null;
    }, []);

    const updateActiveUserMessage = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container || userMessageRefs.current.size === 0) {
        setActiveUserMessageIndex(null);
        return;
      }
      const readingTop = container.getBoundingClientRect().top + 24;
      let activeIndex: number | null = null;
      const userMessages = [...userMessageRefs.current.entries()].sort(
        ([left], [right]) => left - right,
      );
      for (const [index, element] of userMessages) {
        if (element.getBoundingClientRect().top <= readingTop) activeIndex = index;
        else if (activeIndex === null) {
          activeIndex = index;
          break;
        }
      }
      setActiveUserMessageIndex(activeIndex);
    }, []);

    const scrollToBottom = useCallback((smooth = true) => {
      suspendBottomFollowRef.current = false;
      clearMessageTocJumpTimer();
      setStickToBottom(true);
      if (smooth) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      } else {
        const container = scrollContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      }
    }, [clearMessageTocJumpTimer]);

    const handleScroll = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (suspendBottomFollowRef.current) {
        if (distanceFromBottom >= 48) suspendBottomFollowRef.current = false;
        setStickToBottom(false);
      } else {
        setStickToBottom(distanceFromBottom < 48);
      }
      updateActiveUserMessage();
    }, [updateActiveUserMessage]);

    const finishMessageTocJump = useCallback(() => {
      clearMessageTocJumpTimer();
      const container = scrollContainerRef.current;
      if (!container || !suspendBottomFollowRef.current) return;
      suspendBottomFollowRef.current = false;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setStickToBottom(distanceFromBottom < 48);
      updateActiveUserMessage();
    }, [clearMessageTocJumpTimer, updateActiveUserMessage]);

    const handleMessageTocGoTo = useCallback((messageIndex: number) => {
      const target = userMessageRefs.current.get(messageIndex);
      if (!target) return;
      suspendBottomFollowRef.current = true;
      setStickToBottom(false);
      setActiveUserMessageIndex(messageIndex);
      clearMessageTocJumpTimer();
      messageTocJumpTimerRef.current = setTimeout(finishMessageTocJump, 600);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [clearMessageTocJumpTimer, finishMessageTocJump]);

    useEffect(() => {
      void loadConfig();
    }, [loadConfig]);

    useEffect(() => clearMessageTocJumpTimer, [clearMessageTocJumpTimer]);

    useEffect(() => {
      if (stickToBottom && isStreaming) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }, [state.messages, stickToBottom, isStreaming]);

    useEffect(() => {
      setShowSessionList(false);
      setInvokeError(null);
      setSubmitting(false);
      setEditingIndex(null);
      setEditDraft("");
      autoSwitchRef.current = null;
      suspendBottomFollowRef.current = false;
      clearMessageTocJumpTimer();
      setActiveUserMessageIndex(null);
    }, [bookId, clearMessageTocJumpTimer]);

    useEffect(() => {
      if (isWorkspace) setShowSessionList(false);
    }, [isWorkspace]);

    useEffect(() => {
      setEditingIndex(null);
      setEditDraft("");
      suspendBottomFollowRef.current = false;
      clearMessageTocJumpTimer();
      setActiveUserMessageIndex(null);
      scrollToBottom(false);
    }, [clearMessageTocJumpTimer, state.sessionId, scrollToBottom]);

    useEffect(() => {
      if (state.promptId || state.error) setSubmitting(false);
    }, [state.promptId, state.error]);

    useEffect(() => {
      if (state.status !== "bookReady" || state.sessionId || state.sessions.length === 0) return;
      // Sessions arrive newest first.
      const guided = preferGuidedSession
        ? state.sessions.find((session) => session.kind === "guided")
        : undefined;
      const target = (guided ?? state.sessions[0]).id;
      if (autoSwitchRef.current === target) return;
      autoSwitchRef.current = target;
      setInvokeError(null);
      void switchSession(target).catch((error) => {
        autoSwitchRef.current = null;
        setInvokeError(String(error));
      });
    }, [preferGuidedSession, state.sessionId, state.sessions, state.status, switchSession]);

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

    useEffect(() => {
      if (!isGuided || !bookReady) {
        setComputedStep(undefined);
        return;
      }
      // While an answer streams the cursor is about to move; keep the old
      // step on screen (disabled) until the transcript settles.
      if (isStreaming) return;
      let cancelled = false;
      nextGuideStep(currentChapterHref)
        .then((step) => { if (!cancelled) setComputedStep(step); })
        .catch((error) => { if (!cancelled) setInvokeError(String(error)); });
      return () => { cancelled = true; };
    }, [bookReady, currentChapterHref, isGuided, isStreaming, nextGuideStep, state.messages, state.sessionId]);

    useEffect(() => {
      setPickedStep(undefined);
    }, [bookId, state.sessionId]);

    // In a Guided session, picking a chapter from the TOC means "read on from
    // here": the next step starts there. Only a fresh pick counts, not a scope
    // left over from before switching into the session.
    const scopeHref = chapterScope?.href;
    const lastScopeRef = useRef(scopeHref);
    useEffect(() => {
      const changed = lastScopeRef.current !== scopeHref;
      lastScopeRef.current = scopeHref;
      if (!changed || !isGuided || !scopeHref) return;
      let cancelled = false;
      guideStepAt(scopeHref)
        .then((step) => { if (!cancelled && step) setPickedStep(step); })
        .catch((error) => { if (!cancelled) setInvokeError(String(error)); });
      return () => { cancelled = true; };
    }, [guideStepAt, isGuided, scopeHref]);

    const guideStepsKey = isGuided
      ? JSON.stringify(state.messages.flatMap((message) => message.role === "user" && message.guide ? [message.guide] : []))
      : null;
    useEffect(() => {
      onGuideStepsChange?.(guideStepsKey === null ? null : JSON.parse(guideStepsKey) as GuideStep[]);
    }, [guideStepsKey, onGuideStepsChange]);
    useEffect(() => () => onGuideStepsChange?.(null), [onGuideStepsChange]);

    const sendGuideStep = useCallback(async (step: GuideStep) => {
      if (isStreaming || !bookId) return;
      setPickedStep(undefined);
      setEditingIndex(null);
      setEditDraft("");
      setInvokeError(null);
      setSubmitting(true);
      scrollToBottom();
      const label = guideStepLabel(step);
      try {
        await prompt(label, { guide: step }, { role: "user", content: label, guide: step });
      } catch (error) {
        setInvokeError(String(error));
        setSubmitting(false);
      }
    }, [bookId, isStreaming, prompt, scrollToBottom]);

    const handleGuideSkip = useCallback(async () => {
      if (!nextStep || isStreaming) return;
      setInvokeError(null);
      try {
        setPickedStep(await guideStepAfterChapter(nextStep));
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [guideStepAfterChapter, isStreaming, nextStep]);

    const handleAbort = useCallback(async () => {
      setInvokeError(null);
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
      if (!message || message.role !== "user" || message.guide) return;
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
    }, [bookId, editDraft, editPrompt, editingIndex, isStreaming, scrollToBottom, state.messages]);

    const handleRegenerate = useCallback(async () => {
      let lastIndex = -1;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === "user") {
          lastIndex = i;
          break;
        }
      }
      if (lastIndex < 0 || isStreaming || !bookId) return;
      const original = state.messages[lastIndex];
      if (!original || original.role !== "user") return;
      setEditingIndex(null);
      setEditDraft("");
      setInvokeError(null);
      setSubmitting(true);
      scrollToBottom();
      try {
        await editPrompt(
          lastIndex,
          original.content,
          { selection: original.selection, chapterHref: original.chapterHref, guide: original.guide },
          {
            role: "user",
            content: original.content,
            selection: original.selection,
            chapterHref: original.chapterHref,
            ...(original.guide ? { guide: original.guide } : {}),
          },
        );
      } catch (error) {
        setInvokeError(String(error));
        setSubmitting(false);
      }
    }, [bookId, editPrompt, isStreaming, scrollToBottom, state.messages]);

    const handleSwitchBranch = useCallback(async (anchorId: string, direction: -1 | 1) => {
      if (isStreaming) return;
      if (editingIndex !== null) {
        setEditingIndex(null);
        setEditDraft("");
      }
      setInvokeError(null);
      try {
        await switchBranchAtAnchor(anchorId, direction);
        scrollToBottom(false);
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [editingIndex, isStreaming, scrollToBottom, switchBranchAtAnchor]);

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

    const handleSaveSessionConfig = useCallback(async (systemPrompt: string) => {
      const session = configSession;
      if (!session) return;
      setInvokeError(null);
      try {
        await updateSessionConfig(session.id, systemPrompt);
        setConfigSession(null);
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [configSession, updateSessionConfig]);

    const handleModelSelect = useCallback(async (model: string) => {
      const provider = configSnapshot?.provider;
      if (!provider || !configSnapshot?.configured) return;
      setInvokeError(null);
      try {
        await switchProvider(provider, model);
      } catch (error) {
        setInvokeError(t("chat.switchModelFailed", { message: invokeErrorMessage(error) }));
      }
    }, [configSnapshot, switchProvider, t]);

    const handleThinkingLevelChange = useCallback(async (level: string) => {
      setInvokeError(null);
      try {
        await setThinkingLevel(level);
      } catch (error) {
        setInvokeError(String(error));
      }
    }, [setThinkingLevel]);

    const fillInput = useCallback((text: string, chapterHref?: string) => {
      setPendingSelection({ text, chapterHref });
      setInput("");
      inputRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ fillInput }), [fillInput]);

    // Leave the conversation at least half the panel while dragging the rail.
    const startRailResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const panel = e.currentTarget.parentElement;
      const panelWidth = panel?.getBoundingClientRect().width ?? window.innerWidth;
      railResizeRef.current = {
        startX: e.clientX,
        startWidth: railWidth,
        maxWidth: panelWidth / 2,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }, [railWidth]);

    const onRailResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const state = railResizeRef.current;
      if (!state) return;
      setRailWidth(
        clampSessionRailWidth(state.startWidth + (e.clientX - state.startX), state.maxWidth),
      );
    }, []);

    const endRailResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const state = railResizeRef.current;
      if (!state) return;
      railResizeRef.current = null;
      const next = clampSessionRailWidth(
        state.startWidth + (e.clientX - state.startX),
        state.maxWidth,
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
        sessions={state.sessions}
        activeSessionId={state.sessionId}
        isStreaming={isStreaming}
        editingSessionId={editingSessionId}
        editingTitle={editingTitle}
        onNewSession={() => {
          setInvokeError(null);
          if (!isWorkspace) setShowSessionList(false);
          // An untouched ordinary Session is reused; a Guided one keeps its kind.
          if (!(state.sessionId && state.messages.length === 0 && !isGuided)) {
            void newSession().catch((error) => setInvokeError(String(error)));
          }
          queueMicrotask(() => inputRef.current?.focus());
        }}
        onNewGuided={() => {
          setInvokeError(null);
          if (!isWorkspace) setShowSessionList(false);
          if (!(state.sessionId && state.messages.length === 0 && isGuided)) {
            void newSession("guided").catch((error) => setInvokeError(String(error)));
          }
        }}
        onSwitchSession={(id) => {
          setInvokeError(null);
          if (!isWorkspace) setShowSessionList(false);
          void switchSession(id).catch((error) => setInvokeError(String(error)));
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
          void deleteSession(id).catch((error) => setInvokeError(String(error)));
        }}
      />
    );

    return (
      <CitationContext.Provider value={citationActions}>
        {/* As the Agent-mode workspace the panel shares the window's surface;
            docked beside the book it is a card. */}
        <div
          data-testid="chat-panel"
          className={cn("relative flex h-full min-h-0", isWorkspace ? "bg-background" : "bg-card")}
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
          <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
          {/* No header of its own: the titlebar names the book, and the session
              button and model switcher sit in the input row. Only a notice shows
              while the book is still loading. */}
          {!bookReady && (
            <p className="px-4 py-1.5 text-xs text-muted-foreground" role="status">
              {t("chat.waitingBook")}
            </p>
          )}

          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              onScrollEnd={finishMessageTocJump}
              data-testid="chat-message-scroll"
              className={
                "chat-message-scroll h-full space-y-4 overflow-y-auto " +
                (showOutlineRail ? "py-3 pr-3 pl-12" : "p-3")
              }
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
                guided={isGuided}
                onSuggestion={handleSuggestion}
              />
            )}
            {state.messages.map((message, index) => (
              <div
                key={index}
                ref={(element) => {
                  if (message.role !== "user") return;
                  if (element) userMessageRefs.current.set(index, element);
                  else userMessageRefs.current.delete(index);
                }}
                className={cn(
                  message.role === "user" && "scroll-mt-3",
                  // The last two stay laid out so following the bottom never
                  // lands on a size estimate.
                  index < state.messages.length - 2 && "chat-message-offscreen",
                ) || undefined}
                data-user-message-index={message.role === "user" ? index : undefined}
              >
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
                    editable={!message.guide}
                    branchSwitcher={(() => {
                      const anchorId = state.branchAnchors[index];
                      const info = anchorId !== undefined ? state.branchNavigation[anchorId] : undefined;
                      if (!info || info.options.length <= 1 || info.activeIndex < 0) return undefined;
                      return (
                        <BranchSwitcher
                          current={info.activeIndex + 1}
                          total={info.options.length}
                          disabled={isStreaming}
                          onPrev={() => void handleSwitchBranch(info.options[info.activeIndex - 1].anchorId, -1)}
                          onNext={() => void handleSwitchBranch(info.options[info.activeIndex + 1].anchorId, 1)}
                        />
                      );
                    })()}
                  />
                )}
                {message.role === "assistant" && (
                  <AssistantMessage
                    message={message}
                    streaming={isStreaming && index === lastChatIndex}
                    canRegenerate={
                      !isStreaming && bookReady && hasUserMessage && index === lastChatIndex
                    }
                    onRegenerate={handleRegenerate}
                  />
                )}
                {message.role === "notice" && <CompactionNotice notice={message} />}
                {message.role === "recap" && <GuideRecap recap={message} />}
              </div>
            ))}
            {isStreaming && (!lastChatMessage || lastChatMessage.role === "user") && (
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
            {state.compaction && (
              <CompactionStatus status={state.compaction.status} />
            )}
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
            <div ref={messagesEndRef} />
            </div>
            {showOutlineRail && (
              <ChatOutlineRail
                key={`${bookId}:${state.sessionId ?? ""}`}
                items={userMessageTocItems}
                activeMessageIndex={activeUserMessageIndex}
                onGoTo={handleMessageTocGoTo}
              />
            )}
          </div>

          {isGuided && bookReady && (
            <GuideBar
              nextStep={nextStep}
              started={guideStarted}
              disabled={isStreaming}
              onContinue={() => { if (nextStep) void sendGuideStep(nextStep); }}
              onSkim={() => { if (nextStep) void sendGuideStep({ ...nextStep, skim: true }); }}
              onSkip={() => void handleGuideSkip()}
            />
          )}
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={() => void handleSend()}
            onAbort={() => void handleAbort()}
            isStreaming={isStreaming}
            bookReady={bookReady}
            pendingSelection={pendingSelection}
            onClearSelection={() => setPendingSelection(null)}
            chapterScope={chapterScope}
            onClearChapterScope={onClearChapterScope}
            textareaRef={inputRef}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={(level) => void handleThinkingLevelChange(level)}
            leadingControls={
              <>
              {/* In Agent mode the titlebar toggles the session rail. */}
              {!isWorkspace && (
                <Popover open={showSessionList} onOpenChange={setShowSessionList} modal={false}>
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
                    // A new session focuses the input; don't hand focus back
                    // to the toggle over it.
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
                customModels={
                  configSnapshot && configSnapshot.provider && isCustomProviderId(configSnapshot.provider)
                    ? (configSnapshot.customProviders.find(
                        (entry) => entry.id === configSnapshot.provider,
                      )?.models ?? [])
                    : configSnapshot?.provider === CHATGPT_PROVIDER_ID
                      ? (configSnapshot.chatgptAccount?.models ?? [])
                      : []
                }
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
