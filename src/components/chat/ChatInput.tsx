import { useEffect } from "react";
import { Quote, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export interface PendingSelection {
  text: string;
  chapterHref?: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  isStreaming: boolean;
  bookReady: boolean;
  pendingSelection: PendingSelection | null;
  onClearSelection: () => void;
  retryHighlight: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onAbort,
  isStreaming,
  bookReady,
  pendingSelection,
  onClearSelection,
  retryHighlight,
  textareaRef,
}: ChatInputProps) {
  const { t } = useT();
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };
    resize();
    // Panel width is resizable; scrollHeight changes with wrapping, so
    // recompute on element resize too, not just on value changes.
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, textareaRef]);

  return (
    <div className="px-2 pb-2 pt-1">
      {pendingSelection && (
        <div className="mb-1.5 flex items-start gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <Quote className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1">
            {t("chat.quoteSelection", {
              text: `${pendingSelection.text.slice(0, 60)}${pendingSelection.text.length > 60 ? "…" : ""}`,
            })}
          </span>
          <button
            onClick={onClearSelection}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("chat.clearQuote")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="rounded-2xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <textarea
          ref={textareaRef}
          className={cn(
            "w-full resize-none border-0 bg-transparent px-3 py-2 text-sm",
            "placeholder:text-muted-foreground outline-none ring-0 focus:outline-none focus:ring-0",
            retryHighlight && "ring-2 ring-primary",
          )}
          rows={1}
          placeholder={t("chat.placeholder")}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming || !bookReady}
        />
        <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
          <span className="text-[10px] text-muted-foreground">{t("chat.inputHint")}</span>
          {isStreaming ? (
            <Button size="icon-sm" onClick={onAbort} aria-label={t("chat.stop")}>
              <Square />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={onSend}
              disabled={!value.trim() || isStreaming || !bookReady}
              aria-label={t("chat.send")}
            >
              <Send />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
