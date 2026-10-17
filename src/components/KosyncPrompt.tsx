import { Button } from "@/components/ui/button";
import { percentOf } from "@/lib/reader-progress";
import { useT } from "@/lib/i18n";
import type { KosyncPrompt as KosyncPromptState } from "@/lib/use-kosync";

/**
 * Asks before jumping to a newer position pulled by KOReader Sync.
 * Non-modal: reading goes on underneath until the reader answers.
 */
export function KosyncPrompt({
  prompt,
  onJump,
  onStay,
}: {
  prompt: KosyncPromptState;
  onJump: () => void;
  onStay: () => void;
}) {
  const { t } = useT();
  return (
    <div
      role="alertdialog"
      aria-label={t("settings.kosync.title")}
      className="absolute top-4 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-lg border bg-background/95 py-1.5 pr-1.5 pl-3 text-sm shadow-float"
    >
      <span>
        {t("reader.kosyncPrompt", {
          device: prompt.remote.device || "KOReader",
          remote: percentOf(prompt.remote.percentage),
          local: percentOf(prompt.localFraction),
        })}
      </span>
      <Button size="sm" onClick={onJump}>
        {t("reader.kosyncJump")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onStay}>
        {t("reader.kosyncStay")}
      </Button>
    </div>
  );
}
