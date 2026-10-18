import type { ReactNode } from "react";
import { ChevronRight, Minus, Plus } from "lucide-react";
import {
  FONT_FAMILIES,
  THEMES,
  TYPOGRAPHY_RANGES,
  type ContinuousKey,
  type ReaderStyleState,
  type TypographyKey,
} from "@/lib/reader-styles";
import { saveReaderFlow, type ReaderFlow } from "@/lib/reader-flow";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MobileSheet } from "@/mobile/MobileSheet";

const FONT_LABEL_KEYS: Record<(typeof FONT_FAMILIES)[number]["value"], MessageKey> = {
  serif: "settings.font.serif",
  "sans-serif": "settings.font.sans",
  monospace: "settings.font.mono",
};

const THEME_LABEL_KEYS: Record<(typeof THEMES)[number], MessageKey> = {
  light: "settings.theme.light",
  dark: "settings.theme.dark",
  system: "settings.theme.system",
};

/** Coarser than the desktop sliders: one tap should be a visible change. */
const STEPPERS: { key: ContinuousKey; labelKey: MessageKey; step: number; digits: number }[] = [
  { key: "fontSize", labelKey: "mobile.textSize", step: 1, digits: 0 },
  { key: "lineHeight", labelKey: "mobile.spacing", step: 0.1, digits: 1 },
  { key: "pagePadding", labelKey: "mobile.margins", step: 0.25, digits: 2 },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-4 px-6">
      <span className="w-12 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full rounded-full bg-muted p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-9 min-w-0 flex-1 truncate rounded-full px-2 text-sm transition-colors motion-reduce:transition-none",
              active ? "bg-background font-medium text-foreground shadow-soft" : "text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({
  label,
  value,
  display,
  canDecrease,
  canIncrease,
  onStep,
}: {
  label: string;
  value: number;
  display: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onStep: (direction: 1 | -1) => void;
}) {
  const { t } = useT();
  const buttonClass =
    "flex h-10 flex-1 items-center justify-center rounded-full text-foreground/80 transition-colors active:bg-foreground/10 disabled:opacity-30 motion-reduce:transition-none";
  return (
    <div className="flex w-full items-center rounded-full bg-muted p-0.5" data-value={value}>
      <button
        type="button"
        className={buttonClass}
        disabled={!canDecrease}
        aria-label={t("settings.stepper.decrease", { label })}
        onClick={() => onStep(-1)}
      >
        <Minus className="size-5" aria-hidden />
      </button>
      <span className="w-14 shrink-0 text-center text-sm tabular-nums" aria-live="polite">
        {display}
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={!canIncrease}
        aria-label={t("settings.stepper.increase", { label })}
        onClick={() => onStep(1)}
      >
        <Plus className="size-5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The reader's "Aa" panel: the handful of settings people change while
 * reading (size, spacing, margins, typeface, day/night, page turn), as in
 * other Android readers. Everything else is one tap away in Settings.
 */
export function ReaderQuickSettings({
  open,
  onOpenChange,
  styleState,
  onTypographyChange,
  theme,
  onThemeChange,
  flow,
  onFlowChange,
  onMoreSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  styleState: ReaderStyleState;
  onTypographyChange: (key: TypographyKey, value: number | string | boolean) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  flow: ReaderFlow;
  onFlowChange: (flow: ReaderFlow) => void;
  onMoreSettings: () => void;
}) {
  const { t } = useT();
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title={t("mobile.readingSettings")}>
      <div className="pt-1 pb-2">
        {STEPPERS.map((row) => {
          const range = TYPOGRAPHY_RANGES[row.key];
          const value = Number(styleState[row.key]);
          const label = t(row.labelKey);
          return (
            <Row key={row.key} label={label}>
              <Stepper
                label={label}
                value={value}
                display={value.toFixed(row.digits)}
                canDecrease={value > range.min + 1e-9}
                canIncrease={value < range.max - 1e-9}
                onStep={(direction) => {
                  const next = Math.min(range.max, Math.max(range.min, value + direction * row.step));
                  onTypographyChange(row.key, Number(next.toFixed(2)));
                }}
              />
            </Row>
          );
        })}
        <Row label={t("settings.font")}>
          <Segmented
            label={t("settings.font")}
            value={styleState.fontFamily}
            options={FONT_FAMILIES.map((family) => ({
              value: family.value as string,
              label: t(FONT_LABEL_KEYS[family.value]),
            }))}
            onChange={(next) => onTypographyChange("fontFamily", next)}
          />
        </Row>
        <Row label={t("settings.theme")}>
          <Segmented
            label={t("settings.theme")}
            value={theme}
            options={THEMES.map((value) => ({ value: value as string, label: t(THEME_LABEL_KEYS[value]) }))}
            onChange={onThemeChange}
          />
        </Row>
        <Row label={t("mobile.pageTurn")}>
          <Segmented
            label={t("mobile.pageTurn")}
            value={flow}
            options={[
              { value: "paginated" as ReaderFlow, label: t("settings.flow.paginated") },
              { value: "scrolled" as ReaderFlow, label: t("settings.flow.scrolled") },
            ]}
            onChange={(next) => {
              saveReaderFlow(next);
              onFlowChange(next);
            }}
          />
        </Row>
        <button
          type="button"
          onClick={onMoreSettings}
          className="mt-1 flex min-h-12 w-full items-center gap-2 px-6 text-left text-sm transition-colors active:bg-foreground/5"
        >
          <span className="flex-1">{t("mobile.moreSettings")}</span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </button>
      </div>
    </MobileSheet>
  );
}
