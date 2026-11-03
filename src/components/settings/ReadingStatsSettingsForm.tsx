import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import { useReadingStatsEnabled } from "@/lib/reading-stats-prefs";

export function ReadingStatsSettingsForm() {
  const { t } = useT();
  const id = useId();
  const [enabled, setEnabled] = useReadingStatsEnabled();
  return (
    <div className="flex min-h-10 items-center justify-between gap-4">
      <label htmlFor={id} className="text-sm font-medium">{t("settings.stats.record")}</label>
      <Switch id={id} checked={enabled} onCheckedChange={setEnabled} />
    </div>
  );
}
