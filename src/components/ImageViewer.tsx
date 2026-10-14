import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { clampZoom, zoomFromWheel, type ReaderImage } from "@/lib/reader-images";

const ZOOM_STEP = 1.5;
const DOUBLE_CLICK_ZOOM = 2.5;
const DRAG_SLOP_PX = 4;

interface ImageViewerProps {
  image: ReaderImage;
  onClose: () => void;
}

interface ViewState {
  scale: number;
  x: number;
  y: number;
}

const FIT: ViewState = { scale: 1, x: 0, y: 0 };

/**
 * Full-window view of a picture from the Book: fit to the window at first,
 * then wheel / buttons / double-click zoom toward the pointer and drag pans.
 */
export function ImageViewer({ image, onClose }: ImageViewerProps) {
  const { t } = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(
    null,
  );
  const [view, setView] = useState<ViewState>(FIT);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    setView(FIT);
  }, [image.src]);

  // Zoom keeping the point under (px, py) — relative to the stage centre — still.
  const zoomAt = (nextScale: number, px = 0, py = 0) => {
    setView((current) => {
      const scale = clampZoom(nextScale);
      if (scale === 1) return FIT;
      const ratio = scale / current.scale;
      return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  };

  const pointFromCentre = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { px: 0, py: 0 };
    return { px: clientX - (rect.left + rect.width / 2), py: clientY - (rect.top + rect.height / 2) };
  };

  // React's onWheel is passive; preventDefault needs a native listener.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { px, py } = pointFromCentre(event.clientX, event.clientY);
      setView((current) => {
        const scale = zoomFromWheel(current.scale, event.deltaY);
        if (scale === 1) return FIT;
        const ratio = scale / current.scale;
        return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
    drag.moved = true;
    if (view.scale > 1) setView((current) => ({ ...current, x: drag.x + dx, y: drag.y + dy }));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    // A plain click on the backdrop (not the picture) closes the viewer.
    if (!(event.target instanceof HTMLImageElement)) onClose();
  };

  const zoomPct = Math.round(view.scale * 100);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || t("reader.imageViewer")}
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 text-white"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          // Keep the reader's own Esc handlers (side panel) out of it.
          event.stopPropagation();
          onClose();
        } else if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoomAt(view.scale * ZOOM_STEP);
        } else if (event.key === "-") {
          event.preventDefault();
          zoomAt(view.scale / ZOOM_STEP);
        } else if (event.key === "0") {
          event.preventDefault();
          setView(FIT);
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center justify-end gap-1 px-3">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("reader.imageZoomOut")}
          disabled={view.scale <= 1}
          onClick={() => zoomAt(view.scale / ZOOM_STEP)}
        >
          <Minus />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-white/80" aria-live="polite">
          {zoomPct}%
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("reader.imageZoomIn")}
          onClick={() => zoomAt(view.scale * ZOOM_STEP)}
        >
          <Plus />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("reader.imageZoomReset")}
          disabled={view.scale === 1}
          onClick={() => setView(FIT)}
        >
          <RotateCcw />
        </Button>
        <Button
          ref={closeRef}
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div
        ref={stageRef}
        data-testid="image-viewer-stage"
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden p-6"
        style={{ cursor: view.scale > 1 ? "grab" : "zoom-out" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onDoubleClick={(event) => {
          const { px, py } = pointFromCentre(event.clientX, event.clientY);
          if (view.scale > 1) setView(FIT);
          else zoomAt(DOUBLE_CLICK_ZOOM, px, py);
        }}
      >
        <img
          src={image.src}
          alt={image.alt}
          draggable={false}
          className="max-h-full max-w-full object-contain will-change-transform"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            cursor: view.scale > 1 ? "grab" : "zoom-in",
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
