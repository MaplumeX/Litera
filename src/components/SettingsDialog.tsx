import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentConfigDialog } from "@/components/AgentConfigDialog";
import { cn } from "@/lib/utils";
import {
  FONT_FAMILIES,
  FONT_SIZE_LABELS,
  FONT_SIZES,
  THEMES,
  type ReaderStyleState,
} from "@/lib/reader-styles";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  styleState: ReaderStyleState;
  onStyleChange: (state: ReaderStyleState) => void;
  globalTheme: string;
  onThemeChange: (theme: string) => void;
  hasBook: boolean;
}

const THEME_LABELS: Record<string, string> = {
  light: "白天",
  dark: "夜间",
  sepia: "护眼",
};

export function SettingsDialog({
  open,
  onClose,
  styleState,
  onStyleChange,
  globalTheme,
  onThemeChange,
  hasBook,
}: SettingsDialogProps) {
  const [showAgentConfig, setShowAgentConfig] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription className="sr-only">
              阅读偏好与 AI 配置。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* 阅读偏好 */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">阅读偏好</h3>

              {/* Font size */}
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  字体大小
                </div>
                <div className="flex gap-1">
                  {FONT_SIZES.map((size, i) => (
                    <button
                      key={size}
                      onClick={() => onStyleChange({ ...styleState, fontSize: size })}
                      disabled={!hasBook}
                      className={cn(
                        "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                        !hasBook && "cursor-not-allowed opacity-50",
                        styleState.fontSize === size
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent",
                      )}
                    >
                      {FONT_SIZE_LABELS[i]}
                    </button>
                  ))}
                </div>
                {!hasBook && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    打开书籍后生效
                  </p>
                )}
              </div>

              {/* Font family */}
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  字体
                </div>
                <div className="flex gap-1">
                  {FONT_FAMILIES.map((fam) => (
                    <button
                      key={fam.value}
                      onClick={() => onStyleChange({ ...styleState, fontFamily: fam.value })}
                      disabled={!hasBook}
                      style={{ fontFamily: fam.css }}
                      className={cn(
                        "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                        !hasBook && "cursor-not-allowed opacity-50",
                        styleState.fontFamily === fam.value
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
                      onClick={() => onThemeChange(theme)}
                      className={cn(
                        "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                        globalTheme === theme
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

            {/* AI 配置 */}
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">AI 配置</h3>
              <p className="text-xs text-muted-foreground">
                配置 LLM 供应商、API Key 与模型。
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAgentConfig(true)}
              >
                打开 AI 配置
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AgentConfigDialog
        open={showAgentConfig}
        onClose={() => setShowAgentConfig(false)}
      />
    </>
  );
}