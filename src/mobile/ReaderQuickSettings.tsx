import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, Minus, Plus } from "lucide-react";
import {
  DEFAULT_FONT_FAMILY,
  TYPOGRAPHY_RANGES,
  type ContinuousKey,
  type ReaderStyleState,
  type TypographyKey,
  cssFontFamily,
  isGenericFontFamily,
} from "@/lib/reader-styles";
import { importedFontFamilies, useImportedFonts } from "@/lib/imported-fonts";
import { saveReaderFlow, type ReaderFlow } from "@/lib/reader-flow";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Coarser than the desktop sliders: one tap should be a visible change. */
const STEPPERS: { key: ContinuousKey; labelKey: MessageKey; step: number; digits: number }[] = [
  { key: "fontSize", labelKey: "mobile.textSize", step: 1, digits: 0 },
  { key: "lineHeight", labelKey: "mobile.spacing", step: 0.1, digits: 1 },
  { key: "pagePadding", labelKey: "mobile.margins", step: 0.25, digits: 2 },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-4 px-6">
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

function FontOption({
  family,
  label,
  selected,
  onSelect,
}: {
  family: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex min-h-12 w-full items-center gap-3 px-6 text-left transition-colors active:bg-foreground/5"
    >
      <span className="min-w-0 flex-1 truncate" style={{ fontFamily: cssFontFamily(family) }}>
        {label}
      </span>
      <Check className={cn("size-5 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden />
    </button>
  );
}

/** The typeface list: the default, followed by imported fonts. */
function FontList({
  value,
  importedFamilies,
  onChange,
  onBack,
}: {
  value: string;
  importedFamilies: string[];
  onChange: (family: string) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-12 w-full items-center gap-3 px-6 text-left text-sm text-muted-foreground transition-colors active:bg-foreground/5"
      >
        <ArrowLeft className="size-5" aria-hidden />
        <span>{t("settings.font")}</span>
      </button>
      <div role="radiogroup" aria-label={t("settings.font")}>
        <FontOption
          family={DEFAULT_FONT_FAMILY}
          label={t("settings.font.default")}
          selected={isGenericFontFamily(value)}
          onSelect={() => onChange(DEFAULT_FONT_FAMILY)}
        />
        {importedFamilies.length > 0 && (
          <>
            <div className="px-6 pt-4 pb-1 text-xs font-medium text-muted-foreground">
              {t("settings.font.imported")}
            </div>
            {importedFamilies.map((family) => (
              <FontOption
                key={family}
                family={family}
                label={family}
                selected={value === family}
                onSelect={() => onChange(family)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The reader's "Aa" panel: the handful of settings people change while
 * reading (size, spacing, margins, page turn, typeface), as in other Android
 * readers. It takes the bottom toolbar's place rather than covering the
 * page, so every change shows on the text as it's made. Day/night is on the
 * toolbar; everything else is one tap away in Settings.
 */
export function ReaderQuickSettings({
  styleState,
  onTypographyChange,
  flow,
  onFlowChange,
  onMoreSettings,
}: {
  styleState: ReaderStyleState;
  onTypographyChange: (key: TypographyKey, value: number | string | boolean) => void;
  flow: ReaderFlow;
  onFlowChange: (flow: ReaderFlow) => void;
  onMoreSettings: () => void;
}) {
  const { t } = useT();
  const importedFamilies = importedFontFamilies(useImportedFonts());
  const [fontListOpen, setFontListOpen] = useState(false);
  const fontFamily = styleState.fontFamily;
  const fontLabel = isGenericFontFamily(fontFamily) ? t("settings.font.default") : fontFamily;
  return (
    <section
      aria-label={t("mobile.readingSettings")}
      className="max-h-[60vh] overflow-y-auto overscroll-contain py-2 m-enter-fade"
    >
      {fontListOpen ? (
        <FontList
          value={fontFamily}
          importedFamilies={importedFamilies}
          onChange={(family) => {
            onTypographyChange("fontFamily", family);
            setFontListOpen(false);
          }}
          onBack={() => setFontListOpen(false)}
        />
      ) : (
        <>
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
          <Row label={t("settings.font")}>
            <div className="flex w-full min-w-0 items-center gap-2">
              <button
                type="button"
                aria-label={`${t("settings.font")}: ${fontLabel}`}
                onClick={() => setFontListOpen(true)}
                className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted pr-3 pl-4 text-sm transition-colors active:bg-foreground/10"
              >
                <span
                  className="min-w-0 flex-1 truncate text-left"
                  style={{ fontFamily: cssFontFamily(fontFamily) }}
                >
                  {fontLabel}
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onMoreSettings}
                className="flex h-11 shrink-0 items-center gap-1 rounded-full pr-2 pl-3 text-sm transition-colors active:bg-foreground/5"
              >
                <span>{t("mobile.moreSettings")}</span>
                <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
              </button>
            </div>
          </Row>
        </>
      )}
    </section>
  );
}
