import type { PointerEvent } from "react";
import { useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectDesktopOs, usesCustomWindowControls } from "@/lib/platform";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const TITLEBAR_DRAG_THRESHOLD_PX = 4;
const DOUBLE_CLICK_WINDOW_MS = 500;
const DOUBLE_CLICK_DISTANCE_SQ_PX = 100; // 10px

type TitlebarDragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

type LastPointerDown = {
  time: number;
  x: number;
  y: number;
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
  // Track double-click ourselves: Windows WebView2 may report detail=1 for the
  // second pointerdown when pointer capture was set on the first click.
  const lastDownRef = useRef<LastPointerDown | null>(null);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const now = Date.now();
    const last = lastDownRef.current;
    if (
      last !== null &&
      now - last.time < DOUBLE_CLICK_WINDOW_MS &&
      (event.clientX - last.x) ** 2 + (event.clientY - last.y) ** 2 <
        DOUBLE_CLICK_DISTANCE_SQ_PX
    ) {
      event.preventDefault();
      sessionRef.current = null;
      // Reset so a triple-click does not trigger maximize twice.
      lastDownRef.current = null;
      void getCurrentWindow().toggleMaximize();
      return;
    }
    lastDownRef.current = { time: now, x: event.clientX, y: event.clientY };
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
