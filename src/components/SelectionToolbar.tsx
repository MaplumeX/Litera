import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

interface SelectionToolbarProps {
  x: number;
  y: number;
  onHighlight: () => void;
  onAskAgent: () => void;
}

export function SelectionToolbar({
  x,
  y,
  onHighlight,
  onAskAgent,
}: SelectionToolbarProps) {
  const { t } = useT();
  return (
    <div
      className={cn(
        "fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1",
        "rounded-md bg-primary p-0.5 text-xs font-medium text-primary-foreground shadow-lg",
      )}
      style={{ left: `${x}px`, top: `${y - 8}px` }}
    >
      <button
        type="button"
        className="rounded px-3 py-1.5 hover:bg-primary-foreground/15"
        onClick={onHighlight}
      >
        {t("reader.highlight")}
      </button>
      <button
        type="button"
        className="rounded px-3 py-1.5 hover:bg-primary-foreground/15"
        onClick={onAskAgent}
      >
        {t("reader.askAgent")}
      </button>
    </div>
  );
}
