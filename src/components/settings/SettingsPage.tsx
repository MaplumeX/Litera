import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentConfigForm } from "@/components/AgentConfigForm";
import { cn } from "@/lib/utils";
import {
  FONT_FAMILIES,
  FONT_SIZE_LABELS,
  FONT_SIZES,
  LINE_HEIGHTS,
  PAGE_MARGINS,
  TEXT_ALIGNS,
  THEMES,
  type ReaderStyleState,
  type TypographyKey,
} from "@/lib/reader-styles";

type SettingsSection = "typography" | "appearance" | "ai";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "typography", label: "排版" },
  { id: "appearance", label: "外观" },
  { id: "ai", label: "AI" },
];

const THEME_LABELS: Record<string, string> = {
  light: "白天",
  dark: "夜间",
  sepia: "护眼",
};

export interface SettingsPageProps {
  onBack: () => void;
  bookTitle: string | null;
  hasBook: boolean;
  styleState: ReaderStyleState;
  onFontChange: (patch: { fontSize?: number; fontFamily?: string }) => void;
  onTypographyChange: (key: TypographyKey, value: string) => void;
  onRestoreDefault: (key: TypographyKey) => void;
  overriddenKeys: TypographyKey[];
  theme: string;
  onThemeChange: (theme: string) => void;
}

function PresetRow({
  label,
  restore,
  children,
}: {
  label: string;
  restore?: { show: boolean; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {restore?.show && (
          <button
            type="button"
            onClick={restore.onClick}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            恢复默认
          </button>
        )}
      </div>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

function ChoiceButton({
  active,
  disabled,
  onClick,
  children,
  style,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={cn(
        "flex-1 rounded border px-2 py-1 text-xs transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

export function SettingsPage({
  onBack,
  bookTitle,
  hasBook,
  styleState,
  onFontChange,
  onTypographyChange,
  onRestoreDefault,
  overriddenKeys,
  theme,
  onThemeChange,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>("typography");
  const canRestore = (key: TypographyKey) => overriddenKeys.includes(key);

  return (
    <div className="flex h-full min-h-0 flex-1 bg-background text-foreground">
      <aside className="flex w-48 shrink-0 flex-col border-r">
        <div className="px-4 py-3 text-sm font-semibold">设置</div>
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
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-1 border-b px-3 py-2">
          <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="返回">
            <ChevronLeft />
          </Button>
          <span className="text-sm">返回</span>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <p className="mb-5 text-sm text-muted-foreground">
            {hasBook
              ? `正在编辑《${bookTitle || "这本书"}》的排版`
              : "正在编辑默认排版"}
          </p>

          {section === "typography" && (
            <div className="max-w-md space-y-5">
              <PresetRow label="字体大小">
                {FONT_SIZES.map((size, i) => (
                  <ChoiceButton
                    key={size}
                    active={styleState.fontSize === size}
                    disabled={!hasBook}
                    onClick={() => onFontChange({ fontSize: size })}
                  >
                    {FONT_SIZE_LABELS[i]}
                  </ChoiceButton>
                ))}
              </PresetRow>

              <PresetRow label="字体">
                {FONT_FAMILIES.map((fam) => (
                  <ChoiceButton
                    key={fam.value}
                    active={styleState.fontFamily === fam.value}
                    disabled={!hasBook}
                    style={{ fontFamily: fam.css }}
                    onClick={() => onFontChange({ fontFamily: fam.value })}
                  >
                    {fam.label}
                  </ChoiceButton>
                ))}
              </PresetRow>
              {!hasBook && (
                <p className="-mt-3 text-xs text-muted-foreground">打开书籍后生效</p>
              )}

              <PresetRow
                label="行距"
                restore={{
                  show: canRestore("lineHeight"),
                  onClick: () => onRestoreDefault("lineHeight"),
                }}
              >
                {LINE_HEIGHTS.map((item) => (
                  <ChoiceButton
                    key={item.value}
                    active={styleState.lineHeight === item.value}
                    onClick={() => onTypographyChange("lineHeight", item.value)}
                  >
                    {item.label}
                  </ChoiceButton>
                ))}
              </PresetRow>

              <PresetRow
                label="页边距"
                restore={{
                  show: canRestore("pageMargin"),
                  onClick: () => onRestoreDefault("pageMargin"),
                }}
              >
                {PAGE_MARGINS.map((item) => (
                  <ChoiceButton
                    key={item.value}
                    active={styleState.pageMargin === item.value}
                    onClick={() => onTypographyChange("pageMargin", item.value)}
                  >
                    {item.label}
                  </ChoiceButton>
                ))}
              </PresetRow>

              <PresetRow
                label="对齐"
                restore={{
                  show: canRestore("textAlign"),
                  onClick: () => onRestoreDefault("textAlign"),
                }}
              >
                {TEXT_ALIGNS.map((item) => (
                  <ChoiceButton
                    key={item.value}
                    active={styleState.textAlign === item.value}
                    onClick={() => onTypographyChange("textAlign", item.value)}
                  >
                    {item.label}
                  </ChoiceButton>
                ))}
              </PresetRow>
            </div>
          )}

          {section === "appearance" && (
            <div className="max-w-md space-y-5">
              <PresetRow label="主题">
                {THEMES.map((item) => (
                  <ChoiceButton
                    key={item}
                    active={theme === item}
                    onClick={() => onThemeChange(item)}
                  >
                    {THEME_LABELS[item]}
                  </ChoiceButton>
                ))}
              </PresetRow>
            </div>
          )}

          {section === "ai" && (
            <div className="max-w-md">
              <AgentConfigForm />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
