import { useCallback, useEffect, useMemo, useState, type PointerEvent } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { createChatOutlineHoverIntent } from "./hover-intent";

export interface ChatOutlineItem {
  messageIndex: number;
  preview: string;
}

interface ChatOutlineRailProps {
  items: ChatOutlineItem[];
  activeMessageIndex: number | null;
  onGoTo: (messageIndex: number) => void;
}

export function userMessagePreview(content: string, maxLength = 60): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const RESTING_PILL_HEIGHT = 2;
const MAGNIFIED_PILL_HEIGHT = 4;
const RESTING_PILL_WIDTH = 10;
const ACTIVE_PILL_WIDTH = 18;
const MAGNIFIED_PILL_WIDTH = 26;
const MAGNIFY_RADIUS = 3;

function tickMagnification(slotDistance: number): number {
  const distance = Math.abs(slotDistance);
  if (!Number.isFinite(distance) || distance >= MAGNIFY_RADIUS) return 0;
  return (1 + Math.cos((Math.PI * distance) / MAGNIFY_RADIUS)) / 2;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function ChatOutlineRail({
  items,
  activeMessageIndex,
  onGoTo,
}: ChatOutlineRailProps) {
  const { t } = useT();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const reducedMotion = prefersReducedMotion();

  const hoverIntent = useMemo(
    () =>
      createChatOutlineHoverIntent({
        activate: setHoveredIndex,
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (timerId) => window.clearTimeout(timerId),
      }),
    [],
  );

  useEffect(() => () => hoverIntent.dispose(), [hoverIntent]);

  const handlePointerEnterRail = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      hoverIntent.enter({ x: event.clientX, y: event.clientY });
    },
    [hoverIntent],
  );
  const handlePointerMoveRail = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      hoverIntent.move({ x: event.clientX, y: event.clientY });
    },
    [hoverIntent],
  );
  const handlePointerLeaveRail = useCallback(() => {
    hoverIntent.leave();
  }, [hoverIntent]);

  if (items.length < 2) return null;

  const attentionIndex = hoveredIndex ?? focusedIndex;

  return (
    <nav
      data-testid="chat-outline-rail"
      aria-label={t("chat.messageToc")}
      className="absolute top-[10%] bottom-[10%] left-0 z-10 flex w-9 flex-col"
      onPointerEnter={handlePointerEnterRail}
      onPointerMove={handlePointerMoveRail}
      onPointerLeave={handlePointerLeaveRail}
    >
      {items.map((item, index) => {
        const isActive = item.messageIndex === activeMessageIndex;
        const hasAttention = index === attentionIndex;
        const magnification =
          reducedMotion || attentionIndex === null
            ? 0
            : tickMagnification(index - attentionIndex);
        const restingWidth = isActive ? ACTIVE_PILL_WIDTH : RESTING_PILL_WIDTH;
        const pillWidth =
          restingWidth + magnification * (MAGNIFIED_PILL_WIDTH - restingWidth);
        const pillHeight =
          RESTING_PILL_HEIGHT +
          magnification * (MAGNIFIED_PILL_HEIGHT - RESTING_PILL_HEIGHT);

        return (
          <div
            key={item.messageIndex}
            data-testid={`chat-outline-slot-${item.messageIndex}`}
            className="relative flex min-h-0 flex-1 items-stretch"
            onPointerEnter={() => hoverIntent.pointAt(index)}
          >
            <button
              type="button"
              data-testid={`chat-outline-tick-${item.messageIndex}`}
              className="flex h-full w-full items-center justify-start pl-1"
              aria-current={isActive ? "location" : undefined}
              aria-label={t("chat.messageTocItem", {
                number: index + 1,
                preview: item.preview,
              })}
              onClick={() => onGoTo(item.messageIndex)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() =>
                setFocusedIndex((current) => (current === index ? null : current))
              }
            >
              <span
                className={cn(
                  "block rounded-full transition-[width,height,background-color] duration-150 ease-out motion-reduce:transition-none",
                  hasAttention
                    ? "bg-foreground"
                    : isActive
                      ? "bg-muted-foreground"
                      : "bg-border",
                )}
                style={{ width: pillWidth, height: pillHeight }}
              />
            </button>
            {hasAttention ? (
              <div
                data-testid="chat-outline-preview"
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-full z-20 ml-1 h-12 w-[260px] -translate-y-1/2 overflow-hidden rounded-lg border bg-card px-3 py-2 text-sm"
              >
                <p className="line-clamp-2">{item.preview}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
