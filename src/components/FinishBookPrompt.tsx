import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/**
 * Offered at the end of a Book that is not finished yet. Non-modal: reading
 * goes on underneath, and dismissing it changes nothing.
 */
export function FinishBookPrompt({
  onMarkFinished,
  onDismiss,
}: {
  onMarkFinished: () => void;
  onDismiss: () => void;
}) {
  const { t } = useT();
  return (
    <div
      role="status"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background/95 py-1.5 pr-1.5 pl-3 text-sm shadow-md"
    >
      <span>{t("reader.finishPrompt")}</span>
      <Button size="sm" onClick={onMarkFinished}>
        {t("reader.markFinished")}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={onDismiss}
        aria-label={t("reader.dismissFinishPrompt")}
      >
        <X />
      </Button>
    </div>
  );
}
