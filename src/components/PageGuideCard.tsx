import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight, MessageSquare, X } from "lucide-react";
import { placeFootnotePopup } from "@/components/FootnotePopup";
import { MarkdownText } from "@/components/chat/AssistantMessage";
import { Button } from "@/components/ui/button";
import type { GuideStepCardData } from "@/lib/guide-step-cards";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface PageGuideCardProps {
  card: GuideStepCardData;
  /** Anchor point in screen coordinates; when omitted (e.g. mobile), renders as a bottom sheet. */
  x?: number;
  y?: number;
  /** Optional passage text from the clicked/selected paragraph, for "Ask about this passage". */
  passage?: string;
  onClose: () => void;
  onOpenInGuide?: (messageIndex: number) => void;
  onAskPassage?: (passage: string) => void;
}

/**
 * Floating explanation card opened from an already-guided paragraph in the Book pane.
 * Uses host-layer positioning (reusing `placeFootnotePopup`) so Foliate's iframe
 * pagination and column gaps stay untouched.
 */
export function PageGuideCard({
  card,
  x,
  y,
  passage,
  onClose,
  onOpenInGuide,
  onAskPassage,
}: PageGuideCardProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const floating = x !== undefined && y !== undefined;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!floating) {
      setPos(null);
      return;
    }
    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const placed = placeFootnotePopup({
      x,
      y,
      width: rect.width || 416,
      height: rect.height || 320,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPos((prev) => (prev && prev.left === placed.left && prev.top === placed.top ? prev : placed));
  }, [floating, x, y, qaOpen, card.stepIndex]);

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label={t("common.close")}
        className={cn("absolute inset-0", !floating && "bg-black/35")}
        onClick={onClose}
      />
      <div
        ref={containerRef}
        data-testid="page-guide-card"
        role="dialog"
        aria-label={t("reader.guideCardDialog")}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-popover text-popover-foreground shadow-float",
          floating
            ? "max-h-[min(65vh,32rem)] w-[26rem] max-w-[calc(100vw-1rem)] rounded-xl border"
            : "inset-x-0 bottom-0 max-h-[72vh] rounded-t-2xl border-t pb-[var(--safe-bottom,0px)]",
        )}
        style={
          floating
            ? { left: pos?.left ?? x, top: pos?.top ?? y }
            : undefined
        }
      >
        <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{card.label}</span>
          </div>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3 text-sm">
          {card.explanation ? (
            <MarkdownText text={card.explanation} />
          ) : (
            <p className="text-xs text-muted-foreground">{t("reader.guideCardEmpty")}</p>
          )}

          {card.sideQuestions.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-2">
              <button
                type="button"
                aria-expanded={qaOpen}
                onClick={() => setQaOpen((value) => !value)}
                className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-150", qaOpen && "rotate-90")}
                />
                <span>{t("reader.guideCardQuestions", { count: card.sideQuestions.length })}</span>
              </button>
              {qaOpen && (
                <div className="mt-2 space-y-2.5 border-t pt-2 text-xs">
                  {card.sideQuestions.map((qa, idx) => (
                    <div key={idx} className="space-y-1">
                      <p className="font-medium text-foreground">{qa.question}</p>
                      <div className="text-muted-foreground">
                        <MarkdownText text={qa.answer} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {(onOpenInGuide || (onAskPassage && passage)) && (
          <div className="flex items-center justify-end gap-1.5 border-t px-3 py-2">
            {onAskPassage && passage && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  onClose();
                  onAskPassage(passage);
                }}
              >
                <MessageSquare className="h-3 w-3" />
                {t("reader.guideCardAsk")}
              </Button>
            )}
            {onOpenInGuide && (
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  onClose();
                  onOpenInGuide(card.messageIndex);
                }}
              >
                <BookOpen className="h-3 w-3" />
                {t("reader.guideCardOpenInGuide")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
