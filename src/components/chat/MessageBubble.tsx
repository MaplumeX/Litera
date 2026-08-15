import type { KeyboardEvent } from "react";
import { Check, Pencil, Quote, X } from "lucide-react";
import type { AgentMessage } from "@/types/agent";
import { useT } from "@/lib/i18n";

interface MessageBubbleProps {
  message: AgentMessage;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editDisabled: boolean;
}

export function MessageBubble({
  message,
  editing,
  draft,
  onDraftChange,
  onStartEdit,
  onSave,
  onCancel,
  editDisabled,
}: MessageBubbleProps) {
  const { t } = useT();
  const canSave = draft.trim().length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSave) onSave();
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {message.selection && (
        <div className="flex max-w-[85%] items-start gap-1.5 rounded-lg border bg-card/80 px-3 py-1.5 text-xs italic text-muted-foreground">
          <Quote className="mt-0.5 h-3 w-3 shrink-0" />
          <span>&ldquo;{message.selection}&rdquo;</span>
        </div>
      )}
      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="max-w-[85%] min-w-[12rem] resize-none rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground outline-none ring-0 placeholder:text-primary-foreground/50"
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          autoFocus
        />
      ) : (
        <div className="max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      )}
      <div className="flex h-6 items-center justify-end gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={onCancel}
              className="text-muted-foreground/50 transition-colors hover:text-muted-foreground"
              aria-label={t("common.cancel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="text-muted-foreground/50 transition-colors hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30"
              aria-label={t("common.save")}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStartEdit}
            disabled={editDisabled}
            className="text-muted-foreground/50 transition-colors hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30"
            aria-label={t("chat.edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
