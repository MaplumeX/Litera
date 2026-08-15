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
        "rounded-md border border-primary-foreground/10 bg-primary p-0.5 text-xs font-medium text-primary-foreground",
      )}
      style={{ left: `${x}px`, top: `${y - 8}px` }}
    >
      <button
        type="button"
        className="rounded-md px-3 py-1.5 transition-colors duration-200 hover:bg-primary-foreground/15 motion-reduce:transition-none"
        onClick={onHighlight}
      >
        {t("reader.highlight")}
      </button>
      <button
        type="button"
        className="rounded-md px-3 py-1.5 transition-colors duration-200 hover:bg-primary-foreground/15 motion-reduce:transition-none"
        onClick={onAskAgent}
      >
        {t("reader.askAgent")}
      </button>
    </div>
  );
}
