import { Copy, ListEnd, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_HEX } from "@/lib/annotations";
import type { HighlightColor } from "@/types/library";

interface SelectionToolbarProps {
  x: number;
  y: number;
  /** Ringed swatch: the color a plain highlight would use. */
  lastColor: HighlightColor;
  onHighlight: (color: HighlightColor) => void;
  onCopy: () => void;
  onAskAgent: () => void;
  /** In a Guided session: read up to the selection. Absent hides the button. */
  onGuideTo?: () => void;
}

/** One click highlights in a color; picking a color later is the editor's job. */
export function SelectionToolbar({
  x,
  y,
  lastColor,
  onHighlight,
  onCopy,
  onAskAgent,
  onGuideTo,
}: SelectionToolbarProps) {
  const { t } = useT();
  return (
    <div
      className={cn(
        "fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5",
        "rounded-full border bg-popover p-1 text-xs font-medium text-popover-foreground shadow-float",
      )}
      style={{ left: `${x}px`, top: `${y - 8}px` }}
      role="toolbar"
      aria-label={t("reader.highlight")}
    >
      {HIGHLIGHT_COLORS.map((id) => (
        <button
          key={id}
          type="button"
          className="flex size-7 items-center justify-center rounded-full transition-colors duration-200 hover:bg-accent motion-reduce:transition-none"
          aria-label={t("reader.highlightIn", { color: t(`annotations.color.${id}`) })}
          onClick={() => onHighlight(id)}
        >
          <span
            className={cn(
              "size-4 rounded-full border border-black/10 transition-transform duration-200 motion-reduce:transition-none",
              id === lastColor && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
            )}
            style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[id] }}
          />
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-full transition-colors duration-200 hover:bg-accent motion-reduce:transition-none"
        aria-label={t("reader.copy")}
        onClick={onCopy}
      >
        <Copy className="size-3.5" aria-hidden />
      </button>
      {onGuideTo && (
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-full transition-colors duration-200 hover:bg-accent motion-reduce:transition-none"
          aria-label={t("reader.guideTo")}
          title={t("reader.guideTo")}
          onClick={onGuideTo}
        >
          <ListEnd className="size-3.5" aria-hidden />
        </button>
      )}
      <button
        type="button"
        className="flex h-7 items-center gap-1.5 rounded-full pr-3 pl-2.5 transition-colors duration-200 hover:bg-accent motion-reduce:transition-none"
        onClick={onAskAgent}
      >
        <MessageSquare className="size-3.5" aria-hidden />
        {t("reader.askAgent")}
      </button>
    </div>
  );
}
