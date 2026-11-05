import type { KeyboardEvent, ReactNode } from "react";
import { BookOpen, Check, Pencil, Quote, X } from "lucide-react";
import type { UserMessage } from "@/types/agent";
import { MESSAGE_ACTION_CLASS } from "./CopyButton";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: UserMessage;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editDisabled: boolean;
  /** Optional branch switcher rendered in the reserved action row. */
  branchSwitcher?: ReactNode;
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
  branchSwitcher,
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
    <div className="message-row flex flex-col items-end gap-1">
      {message.selection && (
        <div className="flex max-w-[85%] items-start gap-1.5 border-l-2 pl-2.5 text-xs leading-relaxed text-muted-foreground">
          <Quote className="sr-only" />
          <span>&ldquo;{message.selection}&rdquo;</span>
        </div>
      )}
      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="max-w-[85%] min-w-[12rem] resize-none rounded-2xl bg-secondary px-3 py-2 text-sm text-secondary-foreground outline-none ring-2 ring-primary/30"
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          autoFocus
        />
      ) : (
        <div
          className={cn(
            "flex max-w-[85%] items-start gap-1.5 rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-secondary-foreground",
            // Continue or a pick: sent for the reader by a button, quieter than what they typed.
            message.guideRequest ? "text-xs" : "text-sm",
          )}
        >
          {message.guideRequest && <BookOpen className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span>{message.content}</span>
        </div>
      )}
      <div className="flex h-6 items-center justify-end gap-1">
        {branchSwitcher}
        {editing ? (
          <>
            <button
              type="button"
              onClick={onCancel}
              className={MESSAGE_ACTION_CLASS}
              aria-label={t("common.cancel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className={MESSAGE_ACTION_CLASS}
              aria-label={t("common.save")}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </>
        ) : message.guideRequest ? null : (
          <button
            type="button"
            onClick={onStartEdit}
            disabled={editDisabled}
            className={cn(MESSAGE_ACTION_CLASS, "message-actions")}
            aria-label={t("chat.edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
