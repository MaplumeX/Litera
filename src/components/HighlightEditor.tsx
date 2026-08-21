import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_HEX } from "@/lib/annotations";
import type { HighlightColor } from "@/types/library";

interface HighlightEditorProps {
  x: number;
  y: number;
  color: HighlightColor;
  note: string;
  highlightId: string;
  onColorChange: (color: HighlightColor) => void;
  onNoteCommit: (id: string, note: string) => void;
  onDelete: () => void;
}

export function HighlightEditor({
  x,
  y,
  color,
  note: initialNote,
  highlightId,
  onColorChange,
  onNoteCommit,
  onDelete,
}: HighlightEditorProps) {
  const { t } = useT();
  const [note, setNote] = useState(initialNote);
  const noteRef = useRef(note);
  noteRef.current = note;
  const committedRef = useRef(initialNote);
  const commitIdRef = useRef(highlightId);
  const onNoteCommitRef = useRef(onNoteCommit);
  onNoteCommitRef.current = onNoteCommit;

  const commitNote = () => {
    const value = noteRef.current;
    if (value === committedRef.current) return;
    committedRef.current = value;
    onNoteCommitRef.current(commitIdRef.current, value);
  };

  useEffect(() => {
    return () => commitNote();
  }, [highlightId]); // eslint-disable-line react-hooks/exhaustive-deps -- commit via refs

  useEffect(() => {
    commitIdRef.current = highlightId;
    setNote(initialNote);
    committedRef.current = initialNote;
  }, [highlightId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset draft on id only

  return (
    <div
      className={cn(
        "fixed z-50 w-64 -translate-x-1/2 -translate-y-full",
        "rounded-md border bg-popover p-2 text-popover-foreground",
      )}
      style={{ left: `${x}px`, top: `${y - 8}px` }}
      role="group"
      aria-label={t("annotations.editor")}
    >
      <div className="flex items-center gap-1">
        {HIGHLIGHT_COLORS.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={t(`annotations.color.${id}`)}
            aria-pressed={color === id}
            className={cn(
              "size-5 rounded-full border border-black/10",
              color === id && "ring-2 ring-ring ring-offset-1",
            )}
            style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[id] }}
            onClick={() => onColorChange(id)}
          />
        ))}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          aria-label={t("annotations.deleteHighlight")}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
      <Textarea
        aria-label={t("annotations.note")}
        value={note}
        rows={3}
        placeholder={t("annotations.notePlaceholder")}
        onChange={(event) => setNote(event.target.value)}
        onBlur={commitNote}
        className="mt-2 min-h-16 resize-none px-2 py-1.5"
      />
    </div>
  );
}
