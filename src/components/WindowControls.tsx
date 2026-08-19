import type { PointerEvent } from "react";
import { useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectDesktopOs, usesCustomWindowControls } from "@/lib/platform";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const TITLEBAR_DRAG_THRESHOLD_PX = 4;

type TitlebarDragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

export function titlebarClassName(): string {
  return cn(
    "flex h-12 shrink-0 items-center gap-3 border-b",
    detectDesktopOs() === "macos" ? "pl-[72px] pr-4" : "px-4",
  );
}

export function shouldStartTitlebarDrag(dx: number, dy: number): boolean {
  return dx * dx + dy * dy >= TITLEBAR_DRAG_THRESHOLD_PX * TITLEBAR_DRAG_THRESHOLD_PX;
}

export function useTitlebarWindowDrag() {
  const sessionRef = useRef<TitlebarDragSession | null>(null);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.detail >= 2) {
      event.preventDefault();
      sessionRef.current = null;
      void getCurrentWindow().toggleMaximize();
      return;
    }
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.dragging || event.pointerId !== session.pointerId) return;
    if (!shouldStartTitlebarDrag(event.clientX - session.startX, event.clientY - session.startY)) {
      return;
    }
    session.dragging = true;
    void getCurrentWindow().startDragging();
  }, []);

  const endSession = useCallback((event: PointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    sessionRef.current = null;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endSession,
    onPointerCancel: endSession,
  };
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
