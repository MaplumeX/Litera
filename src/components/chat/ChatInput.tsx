import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PendingSelection {
  text: string;
  chapterIndex: number;
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
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <>
      {pendingSelection && (
        <div className="border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
          引用选段：&ldquo;{pendingSelection.text.slice(0, 60)}{pendingSelection.text.length > 60 ? "…" : ""}&rdquo;
          <button onClick={onClearSelection} className="ml-2 text-destructive hover:underline">✕</button>
        </div>
      )}
      <div className="border-t p-2">
        <textarea
          ref={textareaRef}
          className={cn(
            "w-full resize-none rounded border bg-background px-2 py-1 text-sm",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            retryHighlight && "ring-2 ring-primary",
          )}
          rows={2}
          placeholder="输入问题…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming || !bookReady}
        />
        <div className="mt-1 flex justify-end gap-2">
          {isStreaming && (
            <Button size="sm" variant="outline" onClick={onAbort}>停止</Button>
          )}
          <Button size="sm" onClick={onSend} disabled={!value.trim() || isStreaming || !bookReady}>
            发送
          </Button>
        </div>
      </div>
    </>
  );
}
