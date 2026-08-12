import { Pencil } from "lucide-react";
import type { AgentMessage } from "@/types/agent";

interface MessageBubbleProps {
  message: AgentMessage;
  onEdit: (message: AgentMessage) => void;
}

export function MessageBubble({ message, onEdit }: MessageBubbleProps) {
  return (
    <div className="group space-y-1">
      {message.selection && (
        <div className="border-l-4 border-primary/60 bg-muted px-3 py-1 text-sm italic text-muted-foreground">
          &ldquo;{message.selection}&rdquo;
        </div>
      )}
      <div className="relative rounded-lg bg-primary/10 px-3 py-2 text-sm">
        {message.content}
        <button
          onClick={() => onEdit(message)}
          className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="编辑"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
