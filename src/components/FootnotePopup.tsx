import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useT } from "@/lib/i18n";

const MAX_HEIGHT_RATIO = 0.6;
const VIEWPORT_MARGIN = 8;
const POPUP_GAP = 8;
const PLACEHOLDER_HEIGHT = 160;

export interface FootnotePopupPlacementInput {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
  gap?: number;
}

/** Center on the anchor, prefer below, flip above when needed, then clamp. */
export function placeFootnotePopup({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = VIEWPORT_MARGIN,
  gap = POPUP_GAP,
}: FootnotePopupPlacementInput): { left: number; top: number } {
  const maxLeft = viewportWidth - margin - width;
  let left = x - width / 2;
  if (left > maxLeft) left = Math.max(margin, maxLeft);
  if (left < margin) left = margin;

  const spaceBelow = viewportHeight - y;
  const spaceAbove = y;
  const fitsBelow = y + gap + height <= viewportHeight - margin;
  let top = !fitsBelow && spaceAbove > spaceBelow ? y - gap - height : y + gap;
  const maxTop = viewportHeight - margin - height;
  if (top > maxTop) top = Math.max(margin, maxTop);
  if (top < margin) top = margin;

  return { left, top };
}

interface FootnotePopupProps {
  /** Anchor point in screen coordinates; null (or either coordinate null) hides the popup. */
  x: number | null;
  y: number | null;
  /** Footnote content height in px, measured from the inner doc; null until loaded. */
  height: number | null;
  /** The inner <foliate-view> element to mount; null while the content loads. */
  viewElement: HTMLElement | null;
  /** Always-mounted container ref (ReaderView appends the inner view synchronously). */
  mountRef: RefObject<HTMLDivElement | null>;
  /** Close the popup (backdrop click / Esc / inner link). */
  onClose: () => void;
}

/**
 * Fixed-position footnote popup. The inner foliate-view element is created by
 * FootnoteHandler and appended to `mountRef.current` synchronously in the
 * `before-render` handler (foliate's paginator needs a laid-out container
 * while rendering the fragment). This component only positions and sizes the
 * popup; the wrapper stays mounted so the mount point always has layout.
 */
export function FootnotePopup({
  x,
  y,
  height,
  viewElement,
  mountRef,
  onClose,
}: FootnotePopupProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const open = x != null && y != null;

  // Esc closes the popup.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Safety net: if the inner view was not appended synchronously (e.g. React
  // remounted this container after before-render), append it now. Appending an
  // already-attached element is a no-op.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !viewElement) return;
    if (!container.contains(viewElement)) container.appendChild(viewElement);
  }, [viewElement]);

  // Position after layout: center on the anchor, flip above if needed, clamp.
  // The guard in setPos breaks the re-render loop (same values keep state).
  useLayoutEffect(() => {
    if (!open || x == null || y == null) {
      setPos(null);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const { left, top } = placeFootnotePopup({
      x,
      y,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPos((prev) =>
      prev && prev.left === left && prev.top === top ? prev : { left, top },
    );
  }, [open, x, y, height, viewElement]);

  const popupHeight =
    height != null
      ? Math.min(height, window.innerHeight * MAX_HEIGHT_RATIO)
      : PLACEHOLDER_HEIGHT;

  return (
    <div
      className="fixed inset-0 z-40"
      role="presentation"
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      {open && (
        <button
          type="button"
          aria-label={t("reader.closeFootnote")}
          className="absolute inset-0"
          onClick={onClose}
        />
      )}
      <div
        ref={containerRef}
        data-testid="footnote-popup"
        role="dialog"
        aria-label={t("reader.footnoteDialog")}
        className="fixed z-50 w-[26rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground"
        style={{
          left: pos?.left ?? x ?? 0,
          top: pos ? pos.top : (y ?? 0) + POPUP_GAP,
          height: popupHeight,
          visibility: open ? "visible" : "hidden",
        }}
      >
        {!viewElement && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t("reader.footnoteLoading")}
          </div>
        )}
        <div ref={mountRef} className="h-full w-full" />
      </div>
    </div>
  );
}
