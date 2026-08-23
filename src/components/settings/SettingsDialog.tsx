import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { AgentConfigForm } from "@/components/AgentConfigForm";
import { TypographyPreview } from "@/components/settings/TypographyPreview";
import { cn } from "@/lib/utils";
import {
  FONT_FAMILIES,
  TEXT_ALIGNS,
  THEMES,
  TYPOGRAPHY_RANGES,
  clampSnap,
  cssFontFamily,
  formatTypographyValue,
  isGenericFontFamily,
  type ContinuousKey,
  type ReaderStyleState,
  type TypographyKey,
} from "@/lib/reader-styles";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  loadDefaultReaderMode,
  saveDefaultReaderMode,
  type ReaderMode,
} from "@/lib/reader-mode";
import {
  DEFAULT_UI_FONT_FAMILY,
  UI_FONT_SIZE_RANGE,
  applyUiChrome,
  loadUiFontFamily,
  loadUiFontSize,
  saveUiFontFamily,
  saveUiFontSize,
} from "@/lib/ui-chrome-font";

type SettingsSection = "typography" | "appearance" | "ai" | "about";

const SECTIONS: { id: SettingsSection; labelKey: MessageKey }[] = [
  { id: "typography", labelKey: "settings.typography" },
  { id: "appearance", labelKey: "settings.appearance" },
  { id: "ai", labelKey: "settings.ai" },
  { id: "about", labelKey: "settings.about" },
];

const ABOUT_REPO_URL = "https://github.com/MaplumeX/Litera";
const ABOUT_RELEASES_URL = "https://github.com/MaplumeX/Litera/releases";

const THEME_LABEL_KEYS: Record<(typeof THEMES)[number], MessageKey> = {
  light: "settings.theme.light",
  dark: "settings.theme.dark",
  system: "settings.theme.system",
};

const FONT_LABEL_KEYS: Record<(typeof FONT_FAMILIES)[number]["value"], MessageKey> = {
  serif: "settings.font.serif",
  "sans-serif": "settings.font.sans",
  monospace: "settings.font.mono",
};

const ALIGN_LABEL_KEYS: Record<(typeof TEXT_ALIGNS)[number]["value"], MessageKey> = {
  start: "settings.align.start",
  justify: "settings.align.justify",
};

const STEPPER_ROWS: { key: ContinuousKey; labelKey: MessageKey }[] = [
  { key: "fontSize", labelKey: "settings.slider.fontSize" },
  { key: "lineHeight", labelKey: "settings.slider.lineHeight" },
  { key: "contentWidth", labelKey: "settings.slider.contentWidth" },
  { key: "pagePadding", labelKey: "settings.slider.pagePadding" },
  { key: "letterSpacing", labelKey: "settings.slider.letterSpacing" },
  { key: "paragraphSpacing", labelKey: "settings.slider.paragraphSpacing" },
  { key: "firstLineIndent", labelKey: "settings.slider.firstLineIndent" },
];

const TRAILING_UNIT = /(?:px|em|rem)$/i;

function parseStepperInput(raw: string): number | null {
  let text = raw.trim();
  if (!text) return null;
  text = text.replace(TRAILING_UNIT, "").trim();
  if (!text) return null;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function stepperDisplay(field: ContinuousKey, value: number): string {
  const spec = TYPOGRAPHY_RANGES[field];
  const formatted = formatTypographyValue(field, value);
  return spec.unit && formatted.endsWith(spec.unit)
    ? formatted.slice(0, formatted.length - spec.unit.length)
    : formatted;
}

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  bookTitle: string | null;
  hasBook: boolean;
  styleState: ReaderStyleState;
  onTypographyChange: (key: TypographyKey, value: number | string | boolean) => void;
  onRestoreDefault: (key: TypographyKey) => void;
  overriddenKeys: TypographyKey[];
  theme: string;
  onThemeChange: (theme: string) => void;
}

function RestoreButton({
  restore,
}: {
  restore?: { show: boolean; onClick: () => void; label: string };
}) {
  if (!restore?.show) return null;
  return (
    <button
      type="button"
      onClick={restore.onClick}
      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {restore.label}
    </button>
  );
}

function PresetRow({
  label,
  restore,
  children,
  contentClassName,
  inline = false,
}: {
  label: string;
  restore?: { show: boolean; onClick: () => void; label: string };
  children: ReactNode;
  contentClassName?: string;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs font-medium text-muted-foreground">{label}</div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={cn("flex gap-1", contentClassName)}>{children}</div>
          <RestoreButton restore={restore} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <RestoreButton restore={restore} />
      </div>
      <div className={cn("flex gap-1", contentClassName)}>{children}</div>
    </div>
  );
}

function StepperRow({
  label,
  field,
  value,
  restore,
  onChange,
}: {
  label: string;
  field: ContinuousKey;
  value: number;
  restore?: { show: boolean; onClick: () => void; label: string };
  onChange: (value: number) => void;
}) {
  const { t } = useT();
  const spec = TYPOGRAPHY_RANGES[field];
  const display = stepperDisplay(field, value);
  const [draft, setDraft] = useState<string | null>(null);
  const ignoreBlurRef = useRef(false);

  function commit(raw: string) {
    const parsed = parseStepperInput(raw);
    if (parsed == null) return;
    const next = clampSnap(parsed, spec.min, spec.max, spec.step);
    if (next !== value) onChange(next);
  }

  function stepBy(delta: number) {
    const next = clampSnap(value + delta, spec.min, spec.max, spec.step);
    if (next !== value) onChange(next);
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label={t("settings.stepper.decrease", { label })}
          disabled={value <= spec.min}
          onClick={() => stepBy(-spec.step)}
        >
          −
        </Button>
        <Input
          type="text"
          data-typography-stepper=""
          aria-label={label}
          inputMode="decimal"
          value={draft ?? display}
          onFocus={() => setDraft(display)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            if (ignoreBlurRef.current) {
              ignoreBlurRef.current = false;
              setDraft(null);
              return;
            }
            const raw = event.currentTarget.value;
            setDraft(null);
            commit(raw);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              ignoreBlurRef.current = true;
              const raw = event.currentTarget.value;
              setDraft(null);
              commit(raw);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              ignoreBlurRef.current = true;
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          className="h-6 w-14 px-1 text-center text-xs tabular-nums md:text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label={t("settings.stepper.increase", { label })}
          disabled={value >= spec.max}
          onClick={() => stepBy(spec.step)}
        >
          +
        </Button>
        {spec.unit ? (
          <span className="text-xs tabular-nums text-muted-foreground">{spec.unit}</span>
        ) : null}
        <RestoreButton restore={restore} />
      </div>
    </div>
  );
}

function FontFamilyPicker({
  value,
  onChange,
  includeGeist = false,
}: {
  value: string;
  onChange: (value: string) => void;
  includeGeist?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    void invoke<string[]>("list_system_fonts")
      .then((fonts) => {
        if (!disposed) setSystemFonts(fonts);
      })
      .catch((error) => {
        console.error("Failed to list system fonts:", error);
      })
      .finally(() => {
        if (!disposed) setLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const listedSystem = systemFonts.filter((name) => {
    if (isGenericFontFamily(name)) return false;
    if (includeGeist && name === DEFAULT_UI_FONT_FAMILY) return false;
    return true;
  });
  const isGeist = value === DEFAULT_UI_FONT_FAMILY;
  const missing =
    loaded &&
    !isGenericFontFamily(value) &&
    !(includeGeist && isGeist) &&
    !listedSystem.includes(value);
  const selectedLabel = isGenericFontFamily(value)
    ? t(FONT_LABEL_KEYS[value])
    : includeGeist && isGeist
      ? t("settings.font.geist")
      : value;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="min-w-0 truncate" style={{ fontFamily: cssFontFamily(value) }}>
            {selectedLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {missing && (
              <span className="text-xs text-muted-foreground">
                {t("settings.font.unavailable")}
              </span>
            )}
            <ChevronsUpDown className="size-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder={t("settings.font.search")} />
          <CommandList>
            <CommandEmpty>{t("settings.font.empty")}</CommandEmpty>
            <CommandGroup>
              {includeGeist && (
                <CommandItem
                  key={DEFAULT_UI_FONT_FAMILY}
                  value={`${DEFAULT_UI_FONT_FAMILY} ${t("settings.font.geist")}`}
                  keywords={[DEFAULT_UI_FONT_FAMILY, t("settings.font.geist"), "Geist"]}
                  onSelect={() => {
                    onChange(DEFAULT_UI_FONT_FAMILY);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(
                      "size-4",
                      value === DEFAULT_UI_FONT_FAMILY ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span style={{ fontFamily: cssFontFamily(DEFAULT_UI_FONT_FAMILY) }}>
                    {t("settings.font.geist")}
                  </span>
                </CommandItem>
              )}
              {FONT_FAMILIES.map((fam) => {
                const label = t(FONT_LABEL_KEYS[fam.value]);
                return (
                  <CommandItem
                    key={fam.value}
                    value={`${fam.value} ${label}`}
                    keywords={[fam.value, label]}
                    onSelect={() => {
                      onChange(fam.value);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        "size-4",
                        value === fam.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span style={{ fontFamily: fam.css }}>{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {(missing || listedSystem.length > 0) && <CommandSeparator />}
            <CommandGroup>
              {missing && (
                <CommandItem
                  value={value}
                  onSelect={() => {
                    onChange(value);
                    setOpen(false);
                  }}
                >
                  <CheckIcon className="size-4" />
                  <span className="min-w-0 truncate" style={{ fontFamily: cssFontFamily(value) }}>
                    {value}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t("settings.font.unavailable")}
                  </span>
                </CommandItem>
              )}
              {listedSystem.map((name) => (
                <CommandItem
                  key={name}
                  value={name}
                  onSelect={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(
                      "size-4",
                      value === name ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 truncate" style={{ fontFamily: cssFontFamily(name) }}>
                    {name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type SegmentedOption<T extends string> = { value: T; label: string };

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = true,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(from: number, delta: number) {
    const next = (from + delta + options.length) % options.length;
    buttonRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-md bg-muted p-0.5", fullWidth && "w-full")}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(index, -1);
              } else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onChange(option.value);
              }
            }}
            className={cn(
              "rounded-sm border px-2 py-1 text-xs transition-colors duration-200 motion-reduce:transition-none",
              fullWidth && "flex-1",
              selected
                ? "border-border bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  bookTitle,
  hasBook,
  styleState,
  onTypographyChange,
  onRestoreDefault,
  overriddenKeys,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  const { t, locale, setLocale } = useT();
  const [section, setSection] = useState<SettingsSection>("typography");
  const [defaultReaderMode, setDefaultReaderMode] = useState(loadDefaultReaderMode);
  const [uiFontFamily, setUiFontFamily] = useState(loadUiFontFamily);
  const [uiFontSize, setUiFontSize] = useState(loadUiFontSize);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDefaultReaderMode(loadDefaultReaderMode());
    setUiFontFamily(loadUiFontFamily());
    setUiFontSize(loadUiFontSize());
  }, [open]);

  useEffect(() => {
    if (!open || section !== "about") return;
    let disposed = false;
    void getVersion()
      .then((next) => {
        if (!disposed) setVersion(next);
      })
      .catch((error) => {
        console.error("Failed to get app version:", error);
        if (!disposed) setVersion(null);
      });
    return () => {
      disposed = true;
    };
  }, [open, section]);

  const canRestore = (key: TypographyKey) => overriddenKeys.includes(key);
  const restoreLabel = t("settings.restoreDefault");
  const scopeCopy = hasBook
    ? t("settings.editingBook", { title: bookTitle || t("settings.thisBook") })
    : t("settings.editingDefault");

  function openAboutUrl(url: string) {
    void openUrl(url).catch((error) => {
      console.error("Failed to open URL:", error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="flex h-[40rem] w-[768px] max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)]"
        onEscapeKeyDown={(event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.closest("[data-typography-stepper]")) {
            event.preventDefault();
          }
        }}
      >
        <aside className="flex w-48 shrink-0 flex-col border-r">
          <DialogHeader className="gap-0 p-0 text-left">
            <DialogTitle className="px-4 py-3 text-sm font-semibold">
              {t("settings.title")}
            </DialogTitle>
          </DialogHeader>
          <nav className="flex flex-col gap-1 px-2">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                  section === item.id
                    ? "bg-secondary text-secondary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
        </aside>

        <div className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {section === "typography" ? (
            <div className="flex min-h-0 flex-1 flex-row overflow-hidden @max-[519px]:flex-col-reverse">
              <div className="min-h-0 w-64 shrink-0 overflow-y-auto p-6 @max-[519px]:w-auto @max-[519px]:flex-1">
                <DialogDescription className="mb-5">{scopeCopy}</DialogDescription>
                <div className="space-y-5">
                  <PresetRow
                    inline
                    label={t("settings.overrideFont")}
                    restore={{
                      show: canRestore("overrideFont"),
                      onClick: () => onRestoreDefault("overrideFont"),
                      label: restoreLabel,
                    }}
                  >
                    <SegmentedControl
                      fullWidth={false}
                      value={styleState.overrideFont ? "on" : "off"}
                      options={[
                        { value: "off", label: t("settings.override.off") },
                        { value: "on", label: t("settings.override.on") },
                      ]}
                      onChange={(next) => onTypographyChange("overrideFont", next === "on")}
                      ariaLabel={t("settings.overrideFont")}
                    />
                  </PresetRow>

                  <PresetRow
                    inline
                    label={t("settings.overrideLayout")}
                    restore={{
                      show: canRestore("overrideLayout"),
                      onClick: () => onRestoreDefault("overrideLayout"),
                      label: restoreLabel,
                    }}
                  >
                    <SegmentedControl
                      fullWidth={false}
                      value={styleState.overrideLayout ? "on" : "off"}
                      options={[
                        { value: "off", label: t("settings.override.off") },
                        { value: "on", label: t("settings.override.on") },
                      ]}
                      onChange={(next) => onTypographyChange("overrideLayout", next === "on")}
                      ariaLabel={t("settings.overrideLayout")}
                    />
                  </PresetRow>

                  {STEPPER_ROWS.slice(0, 1).map((row) => (
                    <StepperRow
                      key={row.key}
                      label={t(row.labelKey)}
                      field={row.key}
                      value={styleState[row.key]}
                      restore={{
                        show: canRestore(row.key),
                        onClick: () => onRestoreDefault(row.key),
                        label: restoreLabel,
                      }}
                      onChange={(value) => onTypographyChange(row.key, value)}
                    />
                  ))}

                  <PresetRow
                    label={t("settings.font")}
                    contentClassName="w-full"
                    restore={{
                      show: canRestore("fontFamily"),
                      onClick: () => onRestoreDefault("fontFamily"),
                      label: restoreLabel,
                    }}
                  >
                    <FontFamilyPicker
                      value={styleState.fontFamily}
                      onChange={(name) => onTypographyChange("fontFamily", name)}
                    />
                  </PresetRow>

                  {STEPPER_ROWS.slice(1).map((row) => (
                    <StepperRow
                      key={row.key}
                      label={t(row.labelKey)}
                      field={row.key}
                      value={styleState[row.key]}
                      restore={{
                        show: canRestore(row.key),
                        onClick: () => onRestoreDefault(row.key),
                        label: restoreLabel,
                      }}
                      onChange={(value) => onTypographyChange(row.key, value)}
                    />
                  ))}

                  <PresetRow
                    inline
                    label={t("settings.align")}
                    restore={{
                      show: canRestore("textAlign"),
                      onClick: () => onRestoreDefault("textAlign"),
                      label: restoreLabel,
                    }}
                  >
                    <SegmentedControl
                      fullWidth={false}
                      value={styleState.textAlign}
                      options={TEXT_ALIGNS.map((item) => ({
                        value: item.value,
                        label: t(ALIGN_LABEL_KEYS[item.value]),
                      }))}
                      onChange={(next) => onTypographyChange("textAlign", next)}
                      ariaLabel={t("settings.align")}
                    />
                  </PresetRow>
                </div>
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6 @max-[519px]:max-h-[40%] @max-[519px]:flex-none">
                <TypographyPreview styleState={styleState} />
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <DialogDescription className="mb-5">
                {section === "about" ? t("settings.about.description") : scopeCopy}
              </DialogDescription>
              {section === "appearance" && (
                <div className="max-w-md space-y-5">
                  <PresetRow label={t("settings.theme")}>
                    <SegmentedControl
                      value={theme}
                      options={THEMES.map((item) => ({
                        value: item,
                        label: t(THEME_LABEL_KEYS[item]),
                      }))}
                      onChange={onThemeChange}
                      ariaLabel={t("settings.theme")}
                    />
                  </PresetRow>
                  <PresetRow label={t("settings.chrome.font")} contentClassName="w-full">
                    <FontFamilyPicker
                      includeGeist
                      value={uiFontFamily}
                      onChange={(name) => {
                        saveUiFontFamily(name);
                        setUiFontFamily(name);
                        applyUiChrome(uiFontSize, name);
                      }}
                    />
                  </PresetRow>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        {t("settings.chrome.fontSize")}
                      </div>
                      <span className="text-xs tabular-nums text-foreground">
                        {`${uiFontSize}px`}
                      </span>
                    </div>
                    <Slider
                      aria-label={t("settings.chrome.fontSize")}
                      value={[uiFontSize]}
                      min={UI_FONT_SIZE_RANGE.min}
                      max={UI_FONT_SIZE_RANGE.max}
                      step={UI_FONT_SIZE_RANGE.step}
                      onValueChange={([next]) => {
                        if (typeof next !== "number") return;
                        saveUiFontSize(next);
                        setUiFontSize(next);
                        applyUiChrome(next, uiFontFamily);
                      }}
                    />
                  </div>
                  <PresetRow label={t("settings.language")}>
                    <SegmentedControl
                      value={locale}
                      options={[
                        { value: "zh-CN", label: "中文" },
                        { value: "en", label: "English" },
                      ]}
                      onChange={setLocale}
                      ariaLabel={t("settings.language")}
                    />
                  </PresetRow>
                  <PresetRow label={t("settings.defaultMode")}>
                    <SegmentedControl
                      value={defaultReaderMode}
                      options={[
                        { value: "reader" as ReaderMode, label: t("settings.defaultMode.reader") },
                        { value: "agent" as ReaderMode, label: t("settings.defaultMode.agent") },
                      ]}
                      onChange={(next) => {
                        saveDefaultReaderMode(next);
                        setDefaultReaderMode(next);
                      }}
                      ariaLabel={t("settings.defaultMode")}
                    />
                  </PresetRow>
                </div>
              )}

              {section === "ai" && (
                <div className="max-w-md">
                  <AgentConfigForm />
                </div>
              )}

              {section === "about" && (
                <div className="max-w-md space-y-5">
                  <div>
                    <div className="text-base font-medium">Litera</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("settings.about.version")}
                      </span>
                      <span className="text-sm tabular-nums">
                        {version ?? t("settings.about.versionUnavailable")}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto px-0"
                      onClick={() => openAboutUrl(ABOUT_REPO_URL)}
                    >
                      {t("settings.about.repo")}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto px-0"
                      onClick={() => openAboutUrl(ABOUT_RELEASES_URL)}
                    >
                      {t("settings.about.releases")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
