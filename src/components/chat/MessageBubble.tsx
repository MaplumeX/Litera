import { Pencil, Quote } from "lucide-react";
import type { AgentMessage } from "@/types/agent";

interface MessageBubbleProps {
  message: AgentMessage;
  onEdit: (message: AgentMessage) => void;
}

export function MessageBubble({ message, onEdit }: MessageBubbleProps) {
  return (
    <div className="flex flex-col items-end gap-1">
      {message.selection && (
        <div className="flex max-w-[85%] items-start gap-1.5 rounded-lg border bg-card/80 px-3 py-1.5 text-xs italic text-muted-foreground">
          <Quote className="mt-0.5 h-3 w-3 shrink-0" />
          <span>&ldquo;{message.selection}&rdquo;</span>
        </div>
      )}
      <div className="group relative max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
        {message.content}
        <button
          onClick={() => onEdit(message)}
          className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="编辑"
        >
          <Pencil className="h-3.5 w-3.5 text-primary-foreground/70 hover:text-primary-foreground" />
        </button>
      </div>
    </div>
  );
}
