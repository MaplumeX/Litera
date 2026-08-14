import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectDesktopOs, usesCustomWindowControls } from "@/lib/platform";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function titlebarClassName(): string {
  return cn(
    "flex h-12 shrink-0 items-center gap-3 border-b",
    detectDesktopOs() === "macos" ? "pl-[72px] pr-4" : "px-4",
  );
}

export function onTitlebarDragMouseDown(event: MouseEvent<HTMLElement>): void {
  if (event.buttons !== 1 || event.detail !== 2) return;
  event.preventDefault();
  void getCurrentWindow().toggleMaximize();
}

export function WindowControls() {
  const { t } = useT();
  if (!usesCustomWindowControls()) return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("window.minimize")}
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Minus />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("window.maximize")}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        <Square />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("window.close")}
        className="hover:bg-destructive/90 hover:text-white"
        // close() raises CloseRequested so App can flush; destroy() would skip it.
        onClick={() => void getCurrentWindow().close()}
      >
        <X />
      </Button>
    </div>
  );
}
