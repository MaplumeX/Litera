import { useEffect, useState } from "react";
import { Battery, BatteryCharging } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { chapterBoundsAt, percentOf } from "@/lib/reader-progress";
import { READER_FOOTER_POSITIONS, useReaderFooter, type ReaderFooterSettings } from "@/lib/reader-footer";
import type { BatteryStatus } from "@/lib/platform-bridge";
import { useDeviceBattery } from "@/lib/use-device-battery";
import { cn } from "@/lib/utils";

/** Mounted only when a footer slot shows the time. */
function FooterClock() {
  const { locale } = useT();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return <>{now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</>;
}

interface ReaderFooterProps {
  chapterLabel: string;
  fraction: number;
  ticks?: number[];
  className?: string;
}

/** Shared rendering for the reader and the settings preview. */
export function ReaderFooterContent({
  settings,
  chapterLabel,
  fraction,
  ticks = [],
  battery,
  preview = false,
  className,
}: ReaderFooterProps & {
  settings: ReaderFooterSettings;
  battery: BatteryStatus | null;
  preview?: boolean;
}) {
  const { t } = useT();
  if (!settings.enabled || READER_FOOTER_POSITIONS.every((position) => settings[position] === "none")) {
    return null;
  }
  const chapter = ticks.length > 2 ? chapterBoundsAt(fraction, ticks) : undefined;
  const chapterPct = chapter && chapter.end > chapter.start
    ? percentOf((fraction - chapter.start) / (chapter.end - chapter.start))
    : undefined;

  function content(item: ReaderFooterSettings["left"]) {
    switch (item) {
      case "none": return null;
      case "chapter": return <Tip label={chapterLabel} overflowOnly><span>{chapterLabel}</span></Tip>;
      case "book-progress": return (
        <span aria-label={t("reader.footer.bookProgressValue", { pct: percentOf(fraction) })}>
          {percentOf(fraction)}%
        </span>
      );
      case "chapter-progress": return chapterPct == null ? null : (
        <Tip label={t("reader.chapterProgress", { pct: chapterPct })}>
          <span data-testid="reader-chapter-progress" aria-label={t("reader.chapterProgress", { pct: chapterPct })}>
            {chapterPct}%
          </span>
        </Tip>
      );
      case "time": return preview ? "12:34" : <FooterClock />;
      case "battery": {
        const Icon = battery?.charging ? BatteryCharging : Battery;
        const label = battery
          ? t(battery.charging ? "reader.footer.batteryCharging" : "reader.footer.batteryValue", {
            pct: Math.round(battery.level * 100),
          })
          : t("reader.footer.batteryUnavailable");
        return (
          <Tip label={label}>
            <span className="inline-flex max-w-full items-center gap-1" aria-label={label}>
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span>{battery ? `${Math.round(battery.level * 100)}%` : "—"}</span>
            </span>
          </Tip>
        );
      }
    }
  }

  return (
    <div
      data-testid="reader-footer"
      role="group"
      aria-label={t("reader.footer.title")}
      className={cn("grid grid-cols-3 items-center gap-3 text-xs text-muted-foreground tabular-nums", className)}
    >
      {READER_FOOTER_POSITIONS.map((position) => (
        <div
          key={position}
          data-footer-position={position}
          className={cn("min-w-0 truncate", position === "center" && "text-center", position === "right" && "text-right")}
        >
          {content(settings[position])}
        </div>
      ))}
    </div>
  );
}

export function ReaderFooter(props: ReaderFooterProps) {
  const [settings] = useReaderFooter();
  const battery = useDeviceBattery(settings.enabled && READER_FOOTER_POSITIONS.some((position) => settings[position] === "battery"));
  return <ReaderFooterContent {...props} settings={settings} battery={battery} />;
}
