import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

interface CompactionChipProps {
  status: "compacting" | "compacted";
}

export function CompactionChip({ status }: CompactionChipProps) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground">
      {status === "compacting" && <Loader2 className="h-3 w-3 animate-spin" />}
      <span>{status === "compacting" ? t("chat.compacting") : t("chat.compacted")}</span>
    </div>
  );
}