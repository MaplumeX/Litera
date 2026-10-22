import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReaderFooterContent } from "@/components/ReaderFooter";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  READER_FOOTER_ITEMS,
  READER_FOOTER_POSITIONS,
  useReaderFooter,
  type ReaderFooterItem,
  type ReaderFooterPosition,
} from "@/lib/reader-footer";

const ITEM_LABELS: Record<ReaderFooterItem, MessageKey> = {
  none: "reader.footer.none",
  chapter: "reader.footer.chapter",
  "book-progress": "reader.footer.bookProgress",
  "chapter-progress": "reader.footer.chapterProgress",
  time: "reader.footer.time",
  battery: "reader.footer.battery",
};

const POSITION_LABELS: Record<ReaderFooterPosition, MessageKey> = {
  left: "reader.footer.left",
  center: "reader.footer.center",
  right: "reader.footer.right",
};

export function ReaderFooterSettingsForm() {
  const { t } = useT();
  const id = useId();
  const [settings, update] = useReaderFooter();
  return (
    <div className="space-y-4">
      <div className="flex min-h-10 items-center justify-between gap-4">
        <label htmlFor={`${id}-enabled`} className="text-sm font-medium">{t("reader.footer.show")}</label>
        <Switch id={`${id}-enabled`} checked={settings.enabled} onCheckedChange={(enabled) => update({ enabled })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {READER_FOOTER_POSITIONS.map((position) => (
          <div key={position} className="min-w-0 space-y-2">
            <label htmlFor={`${id}-${position}`} className="text-xs text-muted-foreground">{t(POSITION_LABELS[position])}</label>
            <Select
              value={settings[position]}
              disabled={!settings.enabled}
              onValueChange={(value: ReaderFooterItem) => update({ [position]: value })}
            >
              <SelectTrigger id={`${id}-${position}`} className="h-11 w-full min-w-0 px-2">
                <SelectValue className="min-w-0">
                  <span className="truncate">{t(ITEM_LABELS[settings[position]])}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent position="popper">
                {READER_FOOTER_ITEMS.map((item) => (
                  <SelectItem key={item} value={item}>{t(ITEM_LABELS[item])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {settings.enabled && (
        <div className="rounded-lg border bg-muted/20 px-3 pt-3 pb-2">
          <div className="mb-4 text-xs text-muted-foreground">{t("settings.preview")}</div>
          <ReaderFooterContent
            settings={settings}
            chapterLabel={t("reader.footer.sampleChapter")}
            fraction={0.42}
            ticks={[0, 0.4, 0.48, 1]}
            battery={{ level: 0.8, charging: false }}
            preview
            className="min-h-8 border-t border-border/60 pt-2"
          />
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{t("reader.footer.localOnly")}</p>
    </div>
  );
}
