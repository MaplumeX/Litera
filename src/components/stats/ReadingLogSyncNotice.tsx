import { Notice } from "@/components/Notice";
import { useT } from "@/lib/i18n";
import { useReadingLogSyncNotice } from "@/lib/reading-stats-prefs";

/** Once, after the Reading log first reaches the Sync Backend. */
export function ReadingLogSyncNotice({ variant }: { variant?: "snackbar" }) {
  const { t } = useT();
  const { due, dismiss } = useReadingLogSyncNotice();
  if (!due) return null;
  return <Notice variant={variant} tone="info" message={t("stats.syncNotice")} onDismiss={dismiss} />;
}
