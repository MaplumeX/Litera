import { cn } from "@/lib/utils";
import {
  FONT_SIZE_LABELS,
  FONT_SIZES,
  FONT_FAMILIES,
  THEMES,
  type ReaderStyleState,
} from "@/lib/reader-styles";

interface ReaderControlsProps {
  open: boolean;
  state: ReaderStyleState;
  onChange: (state: ReaderStyleState) => void;
}

const THEME_LABELS: Record<string, string> = {
  light: "白天",
  dark: "夜间",
  sepia: "护眼",
};

export function ReaderControls({ open, state, onChange }: ReaderControlsProps) {
  if (!open) return null;

  return (
    <div
      className="absolute right-2 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-3 shadow-md"
    >
      {/* Font size */}
      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          字体大小
        </div>
        <div className="flex gap-1">
          {FONT_SIZES.map((size, i) => (
            <button
              key={size}
              onClick={() => onChange({ ...state, fontSize: size })}
              className={cn(
                "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                state.fontSize === size
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {FONT_SIZE_LABELS[i]}
            </button>
          ))}
        </div>
      </div>

      {/* Font family */}
      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          字体
        </div>
        <div className="flex gap-1">
          {FONT_FAMILIES.map((fam) => (
            <button
              key={fam.value}
              onClick={() => onChange({ ...state, fontFamily: fam.value })}
              style={{ fontFamily: fam.css }}
              className={cn(
                "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                state.fontFamily === fam.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {fam.label}
            </button>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          主题
        </div>
        <div className="flex gap-1">
          {THEMES.map((theme) => (
            <button
              key={theme}
              onClick={() => onChange({ ...state, theme })}
              className={cn(
                "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                state.theme === theme
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {THEME_LABELS[theme]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}