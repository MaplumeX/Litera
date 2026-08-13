import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  consumeWheelDelta,
  hitFromClientX,
  shouldIgnorePagingTarget,
  type WheelPagingState,
} from "@/lib/reader-paging";

// foliate.js view.js defines the <foliate-view> custom element.
// Importing the module registers it with the customElements registry.
import "../foliate-js/view.js";

const CLICK_SLOP_PX = 5;

function hasHrefTarget(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return false;
  const node = target as {
    nodeType?: number;
    parentElement?: EventTarget | null;
    closest?: (selector: string) => unknown;
  };
  if (node.nodeType === 3) return hasHrefTarget(node.parentElement ?? null);
  return Boolean(node.closest?.("a[href]"));
}

function bindPointerPaging(
  target: EventTarget,
  getX: (event: PointerEvent) => number,
  getWidth: () => number,
  getSelection: () => Selection | null,
  pageLeft: () => void,
  pageRight: () => void,
): () => void {
  let startX = 0;
  let startY = 0;
  let armed = false;
  let hadSelection = false;

  const onDown = (event: Event) => {
    const pe = event as PointerEvent;
    if (pe.button !== 0) return;
    startX = pe.clientX;
    startY = pe.clientY;
    armed = true;
    const sel = getSelection();
    hadSelection = Boolean(sel && !sel.isCollapsed);
  };

  const onUp = (event: Event) => {
    if (!armed) return;
    armed = false;
    const pe = event as PointerEvent;
    if (pe.button !== 0) return;
    if (Math.hypot(pe.clientX - startX, pe.clientY - startY) >= CLICK_SLOP_PX) return;
    if (hasHrefTarget(pe.target)) return;
    // pointerdown typically collapses an existing range; don't page on that click.
    if (hadSelection) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    const zone = hitFromClientX(getX(pe), getWidth());
    if (zone === "left") pageLeft();
    else if (zone === "right") pageRight();
  };

  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointerup", onUp);
  return () => {
    target.removeEventListener("pointerdown", onDown);
    target.removeEventListener("pointerup", onUp);
  };
}

interface RelocateDetail {
  fraction?: number;
  index?: number;
  tocItem?: { label?: string; fraction?: number };
}

export interface SelectionCapture {
  text: string;
  chapterIndex: number;
}

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface ReaderViewHandle {
  prev: () => void;
  next: () => void;
  goToFraction: (frac: number) => void;
  goToTocItem: (href: string) => void;
  setStyles: (css: string) => void;
  getToc: () => TocItem[];
}

interface ReaderViewProps {
  /** Bytes of an opened EPUB file, or null when no file is loaded. */
  fileData: { bytes: Uint8Array<ArrayBuffer>; name: string } | null;
  /** Called when the reader relocates (page turn / scroll). */
  onRelocate?: (index: number, fraction: number, label?: string) => void;
  /** Called when the user clicks the "问 agent" button on a selection. */
  onSelectionCapture?: (capture: SelectionCapture) => void;
  /** Last reading fraction to restore (0-1), from library persistence. */
  initialFraction?: number;
  /** Called after the book is opened and toc is available. */
  onBookReady?: (toc: TocItem[]) => void;
}

export const ReaderView = forwardRef<ReaderViewHandle, ReaderViewProps>(
  function ReaderView({ fileData, onRelocate, onSelectionCapture, initialFraction, onBookReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<HTMLElement | null>(null);
    const currentChapterRef = useRef(0);
    // Keep latest callbacks in refs so the open-file effect doesn't re-run
    // when parent recreates them (e.g. onBookReady changing with styleState).
    const onRelocateRef = useRef(onRelocate);
    const onBookReadyRef = useRef(onBookReady);
    onRelocateRef.current = onRelocate;
    onBookReadyRef.current = onBookReady;
    const [selectionPos, setSelectionPos] = useState<{
      x: number;
      y: number;
      text: string;
    } | null>(null);

    // Mount the <foliate-view> custom element once.
    useEffect(() => {
      if (!containerRef.current) return;
      const el = document.createElement("foliate-view") as HTMLElement;
      el.style.display = "block";
      el.style.width = "100%";
      el.style.height = "100%";
      containerRef.current.appendChild(el);
      viewRef.current = el;

      const handleRelocate = (e: Event) => {
        const detail = (e as CustomEvent<RelocateDetail>).detail;
        const index = detail.index ?? 0;
        currentChapterRef.current = index;
        const fraction = detail.fraction ?? 0;
        const label = detail.tocItem?.label;
        onRelocateRef.current?.(index, fraction, label);
      };
      el.addEventListener("relocate", handleRelocate as EventListener);

      type FoliatePager = {
        goLeft?: () => void | Promise<void>;
        goRight?: () => void | Promise<void>;
        prev?: () => void | Promise<void>;
        next?: () => void | Promise<void>;
      };
      const pager = () => el as unknown as FoliatePager;
      const pageLeft = () => {
        const view = pager();
        if (view.goLeft) void view.goLeft();
        else void view.prev?.();
      };
      const pageRight = () => {
        const view = pager();
        if (view.goRight) void view.goRight();
        else void view.next?.();
      };
      const pagePrev = () => {
        void pager().prev?.();
      };
      const pageNext = () => {
        void pager().next?.();
      };

      let wheelState: WheelPagingState = { accumulated: 0, lastTime: 0, flipped: false };
      const handleWheel = (e: Event) => {
        const we = e as WheelEvent;
        if (we.ctrlKey) return;
        we.preventDefault();
        const delta = Math.abs(we.deltaX) > Math.abs(we.deltaY) ? we.deltaX : we.deltaY;
        const now = we.timeStamp || Date.now();
        const result = consumeWheelDelta(wheelState, delta, now, we.deltaMode);
        wheelState = result.state;
        if (result.turn === 1) pageNext();
        else if (result.turn === -1) pagePrev();
      };

      const handleKeyDown = (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.defaultPrevented) return;
        if (ke.altKey || ke.metaKey || ke.ctrlKey || ke.shiftKey) return;
        if (shouldIgnorePagingTarget(ke.target)) return;
        if (ke.key === "ArrowLeft") {
          ke.preventDefault();
          pageLeft();
        } else if (ke.key === "ArrowRight") {
          ke.preventDefault();
          pageRight();
        }
      };

      const unbindHostPointer = bindPointerPaging(
        el,
        (ev) => ev.clientX - el.getBoundingClientRect().left,
        () => el.clientWidth,
        () => window.getSelection(),
        pageLeft,
        pageRight,
      );
      el.addEventListener("wheel", handleWheel, { passive: false });
      window.addEventListener("keydown", handleKeyDown);

      let unbindDoc: (() => void) | undefined;
      const handleLoad = (e: Event) => {
        unbindDoc?.();
        unbindDoc = undefined;
        const doc = (e as CustomEvent<{ doc?: Document }>).detail?.doc;
        if (!doc) return;
        const unbindPointer = bindPointerPaging(
          doc,
          (ev) => ev.clientX,
          () => doc.defaultView?.innerWidth ?? 0,
          () => doc.getSelection(),
          pageLeft,
          pageRight,
        );
        doc.addEventListener("keydown", handleKeyDown);
        doc.addEventListener("wheel", handleWheel, { passive: false });
        unbindDoc = () => {
          unbindPointer();
          doc.removeEventListener("keydown", handleKeyDown);
          doc.removeEventListener("wheel", handleWheel);
        };
      };
      el.addEventListener("load", handleLoad as EventListener);

      return () => {
        el.removeEventListener("relocate", handleRelocate as EventListener);
        el.removeEventListener("load", handleLoad as EventListener);
        unbindDoc?.();
        unbindHostPointer();
        el.removeEventListener("wheel", handleWheel);
        window.removeEventListener("keydown", handleKeyDown);
        (el as unknown as { close?: () => void }).close?.();
        el.remove();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Open file when fileData changes.
    useEffect(() => {
      if (!fileData || !viewRef.current) return;
      const view = viewRef.current as unknown as {
        open: (file: File) => Promise<void>;
        init: (opts: Record<string, unknown>) => Promise<void>;
        goToFraction: (frac: number) => Promise<void>;
      };
      const { bytes, name } = fileData;
      const file = new File([bytes], name);
      const fractionToRestore = initialFraction;
      view
        .open(file)
        .then(async () => {
          await view.init({}).catch((err: unknown) =>
            console.error("foliate init error:", err),
          );
          // Restore reading position after init completes (init internally calls
          // next(), so goToFraction must run after to avoid conflicting navigation).
          if (fractionToRestore != null && fractionToRestore > 0) {
            await view.goToFraction(fractionToRestore).catch((err: unknown) =>
              console.error("foliate goToFraction error:", err),
            );
          }
          // Notify App that the book is ready and toc is available.
          const book = (view as unknown as { book?: { toc?: TocItem[] } }).book;
          onBookReadyRef.current?.(book?.toc ?? []);
        })
        .catch((err: unknown) => console.error("foliate open error:", err));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileData, initialFraction]);

    // Selection capture: listen for selectionchange inside the foliate-view.
    useEffect(() => {
      if (!viewRef.current) return;
      const view = viewRef.current;

      const handleSelection = () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelectionPos(null);
          return;
        }
        const text = sel.toString().trim();
        if (!text) {
          setSelectionPos(null);
          return;
        }
        // Only show button if the selection is inside the foliate-view element.
        const range = sel.getRangeAt(0);
        if (!view.contains(range.commonAncestorContainer)) {
          setSelectionPos(null);
          return;
        }
        const rect = range.getBoundingClientRect();
        setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top, text });
      };

      document.addEventListener("selectionchange", handleSelection);
      return () => document.removeEventListener("selectionchange", handleSelection);
    }, []);

    const handleAskAgent = useCallback(() => {
      if (!selectionPos) return;
      const capture: SelectionCapture = {
        text: selectionPos.text,
        chapterIndex: currentChapterRef.current,
      };
      onSelectionCapture?.(capture);
      setSelectionPos(null);
      window.getSelection()?.removeAllRanges();
    }, [selectionPos, onSelectionCapture]);

    const prev = useCallback(async () => {
      await (viewRef.current as unknown as { prev?: () => Promise<void> })?.prev?.();
    }, []);
    const next = useCallback(async () => {
      await (viewRef.current as unknown as { next?: () => Promise<void> })?.next?.();
    }, []);
    const goToFraction = useCallback(async (frac: number) => {
      await (viewRef.current as unknown as { goToFraction?: (f: number) => Promise<void> })
        ?.goToFraction?.(frac)
        .catch((err: unknown) => console.error("goToFraction error:", err));
    }, []);
    const goToTocItem = useCallback(async (href: string) => {
      await (viewRef.current as unknown as { goTo?: (h: string) => Promise<void> })
        ?.goTo?.(href)
        .catch((err: unknown) => console.error("goTo error:", err));
    }, []);
    const setStyles = useCallback((css: string) => {
      const view = viewRef.current as unknown as { renderer?: { setStyles?: (c: string) => void } };
      view?.renderer?.setStyles?.(css);
    }, []);
    const getToc = useCallback((): TocItem[] => {
      const view = viewRef.current as unknown as { book?: { toc?: TocItem[] } };
      return view?.book?.toc ?? [];
    }, []);

    useImperativeHandle(
      ref,
      () => ({ prev, next, goToFraction, goToTocItem, setStyles, getToc }),
      [prev, next, goToFraction, goToTocItem, setStyles, getToc],
    );

    return (
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />

        {selectionPos && (
          <button
            onClick={handleAskAgent}
            className={cn(
              "fixed z-50 -translate-x-1/2 -translate-y-full",
              "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg",
              "hover:bg-primary/90 transition-colors",
            )}
            style={{
              left: `${selectionPos.x}px`,
              top: `${selectionPos.y - 8}px`,
            }}
          >
            问 agent
          </button>
        )}
      </div>
    );
  },
);
