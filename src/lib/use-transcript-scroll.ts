import { useCallback, useEffect, useRef, useState } from "react";

interface UseTranscriptScrollOptions {
  bookId: string;
  sessionId: string | null;
  isStreaming: boolean;
  /** Value that changes when the transcript updates (triggers bottom follow while streaming). */
  contentKey: unknown;
  /** Item indices tracked by the outline rail. */
  trackedIndices: readonly number[];
}

/**
 * Shared scroll-follow and outline-rail tracking for `ChatWorkspace` and `GuideWorkspace`.
 */
export function useTranscriptScroll({
  bookId,
  sessionId,
  isStreaming,
  contentKey,
  trackedIndices,
}: UseTranscriptScrollOptions) {
  const [stickToBottom, setStickToBottom] = useState(true);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLDivElement>());
  const suspendBottomFollowRef = useRef(false);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackedSetRef = useRef<Set<number>>(new Set());
  trackedSetRef.current = new Set(trackedIndices);

  const clearJumpTimer = useCallback(() => {
    if (jumpTimerRef.current === null) return;
    clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = null;
  }, []);

  const updateActiveItem = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || itemRefs.current.size === 0) {
      setActiveIndex(null);
      return;
    }
    const readingTop = container.getBoundingClientRect().top + 24;
    let current: number | null = null;
    const tracked = [...itemRefs.current.entries()]
      .filter(([index]) => trackedSetRef.current.has(index))
      .sort(([left], [right]) => left - right);
    for (const [index, element] of tracked) {
      if (element.getBoundingClientRect().top <= readingTop) current = index;
      else if (current === null) {
        current = index;
        break;
      }
    }
    setActiveIndex(current);
  }, []);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      suspendBottomFollowRef.current = false;
      clearJumpTimer();
      setStickToBottom(true);
      if (smooth) {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      } else {
        const container = scrollContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      }
    },
    [clearJumpTimer],
  );

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
    updateActiveItem();
  }, [updateActiveItem]);

  const finishJump = useCallback(() => {
    clearJumpTimer();
    const container = scrollContainerRef.current;
    if (!container || !suspendBottomFollowRef.current) return;
    suspendBottomFollowRef.current = false;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setStickToBottom(distanceFromBottom < 48);
    updateActiveItem();
  }, [clearJumpTimer, updateActiveItem]);

  const scrollToItem = useCallback(
    (index: number) => {
      const target = itemRefs.current.get(index);
      if (!target) return;
      suspendBottomFollowRef.current = true;
      setStickToBottom(false);
      setActiveIndex(index);
      clearJumpTimer();
      jumpTimerRef.current = setTimeout(finishJump, 600);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [clearJumpTimer, finishJump],
  );

  const registerItem = useCallback((index: number, element: HTMLDivElement | null) => {
    if (element) itemRefs.current.set(index, element);
    else itemRefs.current.delete(index);
  }, []);

  useEffect(() => clearJumpTimer, [clearJumpTimer]);

  useEffect(() => {
    if (stickToBottom && isStreaming) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [contentKey, stickToBottom, isStreaming]);

  useEffect(() => {
    suspendBottomFollowRef.current = false;
    clearJumpTimer();
    setActiveIndex(null);
  }, [bookId, clearJumpTimer]);

  useEffect(() => {
    suspendBottomFollowRef.current = false;
    clearJumpTimer();
    setActiveIndex(null);
    scrollToBottom(false);
  }, [clearJumpTimer, sessionId, scrollToBottom]);

  return {
    scrollContainerRef,
    endRef,
    activeIndex,
    registerItem,
    handleScroll,
    finishJump,
    scrollToBottom,
    scrollToItem,
  };
}
