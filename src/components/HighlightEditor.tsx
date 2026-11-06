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
        "rounded-xl bg-popover p-2.5 font-sans text-popover-foreground shadow-float",
      )}
      style={{ left: `${x}px`, top: `${y - 8}px` }}
      role="group"
      aria-label={t("annotations.editor")}
    >
      <div className="flex items-center gap-1.5 pl-0.5">
        {HIGHLIGHT_COLORS.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={t(`annotations.color.${id}`)}
            aria-pressed={color === id}
            className={cn(
              "size-[18px] rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/10%)] transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover motion-reduce:transition-none",
              color === id && "ring-2 ring-foreground/50 ring-offset-2 ring-offset-popover",
            )}
            style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[id] }}
            onClick={() => onColorChange(id)}
          />
        ))}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
        className="mt-2.5 min-h-16 resize-none rounded-lg border-transparent bg-muted px-2.5 py-2 shadow-none focus-visible:bg-popover dark:bg-muted dark:focus-visible:bg-popover"
      />
    </div>
  );
}
