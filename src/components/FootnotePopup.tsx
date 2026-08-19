import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useT } from "@/lib/i18n";

const MAX_HEIGHT_RATIO = 0.6;
const VIEWPORT_MARGIN = 8;
const POPUP_GAP = 8;
const PLACEHOLDER_HEIGHT = 160;

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

  // Clamp the popup inside the viewport once its layout is known. The guard in
  // setPos breaks the re-render loop (clamped values must return the same state).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y + POPUP_GAP;
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - rect.width;
    const maxTop = window.innerHeight - VIEWPORT_MARGIN - rect.height;
    if (left > maxLeft) left = Math.max(VIEWPORT_MARGIN, maxLeft);
    if (top > maxTop) top = Math.max(VIEWPORT_MARGIN, maxTop);
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
