import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  consumeWheelDelta,
  hitFromClientX,
  pageLocalX,
  shouldIgnorePagingTarget,
  type WheelPagingState,
} from "@/lib/reader-paging";
import { SelectionToolbar } from "@/components/SelectionToolbar";
import type { HighlightRecord } from "@/types/library";

// foliate.js view.js defines the <foliate-view> custom element.
// Importing the module registers it with the customElements registry.
import "../foliate-js/view.js";
import { Overlayer } from "../foliate-js/overlayer.js";

const HIGHLIGHT_COLOR = "#fbbf24";

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
  cfi?: string;
  tocItem?: { label?: string; href?: string; fraction?: number };
}

export interface ReaderLocation {
  cfi: string;
  fraction: number;
  label?: string;
}

export interface SelectionCfi {
  cfi: string;
  excerpt: string;
}

export interface SelectionCapture {
  text: string;
  chapterHref?: string;
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
  goToCfi: (cfi: string) => Promise<boolean>;
  setStyles: (css: string) => void;
  getToc: () => TocItem[];
  getLocation: () => ReaderLocation | null;
  getSelectionCfi: () => SelectionCfi | null;
  addHighlight: (cfi: string) => void;
  removeHighlight: (cfi: string) => void;
}

interface ReaderViewProps {
  /** Bytes of an opened EPUB file, or null when no file is loaded. */
  fileData: { bytes: Uint8Array<ArrayBuffer>; name: string } | null;
  /** Called when the reader relocates (page turn / scroll). */
  onRelocate?: (index: number, fraction: number, label?: string, chapterHref?: string) => void;
  /** Called when the user clicks the ask-agent button on a selection. */
  onSelectionCapture?: (capture: SelectionCapture) => void;
  /** Called when the user clicks highlight on a selection. */
  onHighlight?: (selection: SelectionCfi) => void;
  /** Highlights to paint on create-overlay / after snapshot load. */
  highlights?: HighlightRecord[];
  /** Last reading fraction to restore (0-1), from library persistence. */
  initialFraction?: number;
  /** Called after the book is opened and toc is available. */
  onBookReady?: (toc: TocItem[]) => void;
}

type FoliateAnnotator = {
  getCFI?: (index: number, range?: Range) => string;
  addAnnotation?: (annotation: { value: string }, remove?: boolean) => Promise<unknown>;
  deleteAnnotation?: (annotation: { value: string }) => Promise<unknown>;
  goTo?: (target: string) => Promise<unknown>;
  renderer?: { getContents?: () => { index: number; doc?: Document }[] };
};

function selectionOverlayPos(doc: Document, range: Range): { x: number; y: number } | null {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const frame = doc.defaultView?.frameElement;
  const offset = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return {
    x: offset.left + rect.left + rect.width / 2,
    y: offset.top + rect.top,
  };
}

function paintHighlight(view: FoliateAnnotator, cfi: string, remove = false) {
  const task = remove
    ? view.deleteAnnotation?.({ value: cfi })
    : view.addAnnotation?.({ value: cfi });
  void Promise.resolve(task).catch((err: unknown) =>
    console.error(remove ? "deleteAnnotation error:" : "addAnnotation error:", err),
  );
}

function readIframeSelection(view: FoliateAnnotator): SelectionCfi | null {
  const contents = view.renderer?.getContents?.() ?? [];
  for (const { index, doc } of contents) {
    if (!doc) continue;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
    const excerpt = sel.toString().trim();
    if (!excerpt) continue;
    const range = sel.getRangeAt(0);
    const cfi = view.getCFI?.(index, range);
    if (!cfi) continue;
    return { cfi, excerpt };
  }
  return null;
}

export const ReaderView = forwardRef<ReaderViewHandle, ReaderViewProps>(
  function ReaderView(
    {
      fileData,
      onRelocate,
      onSelectionCapture,
      onHighlight,
      highlights = [],
      initialFraction,
      onBookReady,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<HTMLElement | null>(null);
    const currentChapterHrefRef = useRef<string | undefined>(undefined);
    const lastLocationRef = useRef<ReaderLocation | null>(null);
    const lastSelectionDocRef = useRef<Document | null>(null);
    const highlightsRef = useRef(highlights);
    highlightsRef.current = highlights;
    const paintedCfisRef = useRef(new Set<string>());
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
        const view = el as unknown as { book?: { sections?: { id?: string }[] } };
        const chapterHref = detail.tocItem?.href || view.book?.sections?.[index]?.id || undefined;
        currentChapterHrefRef.current = chapterHref;
        const fraction = detail.fraction ?? 0;
        const label = detail.tocItem?.label;
        if (detail.cfi) {
          lastLocationRef.current = { cfi: detail.cfi, fraction, label };
        }
        onRelocateRef.current?.(index, fraction, label, chapterHref);
      };
      el.addEventListener("relocate", handleRelocate as EventListener);

      const handleCreateOverlay = () => {
        const view = el as unknown as FoliateAnnotator;
        for (const highlight of highlightsRef.current) {
          paintHighlight(view, highlight.cfi);
        }
      };
      const handleDrawAnnotation = (e: Event) => {
        const detail = (e as CustomEvent<{ draw?: (fn: unknown, opts: { color: string }) => void }>).detail;
        detail.draw?.(Overlayer.highlight, { color: HIGHLIGHT_COLOR });
      };
      el.addEventListener("create-overlay", handleCreateOverlay as EventListener);
      el.addEventListener("draw-annotation", handleDrawAnnotation as EventListener);

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
      const handleIframeSelection = (doc: Document) => {
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelectionPos(null);
          lastSelectionDocRef.current = null;
          return;
        }
        const text = sel.toString().trim();
        if (!text) {
          setSelectionPos(null);
          lastSelectionDocRef.current = null;
          return;
        }
        const range = sel.getRangeAt(0);
        const pos = selectionOverlayPos(doc, range);
        if (!pos) {
          setSelectionPos(null);
          return;
        }
        lastSelectionDocRef.current = doc;
        setSelectionPos({ x: pos.x, y: pos.y, text });
      };
      const handleLoad = (e: Event) => {
        unbindDoc?.();
        unbindDoc = undefined;
        const doc = (e as CustomEvent<{ doc?: Document }>).detail?.doc;
        if (!doc) return;
        const pageWidthOf = (chapterDoc: Document) =>
          chapterDoc.documentElement?.clientWidth ?? 0;
        const unbindPointer = bindPointerPaging(
          doc,
          (ev) => pageLocalX(ev.clientX, pageWidthOf(doc)),
          () => pageWidthOf(doc),
          () => doc.getSelection(),
          pageLeft,
          pageRight,
        );
        const onSelectionChange = () => handleIframeSelection(doc);
        doc.addEventListener("keydown", handleKeyDown);
        doc.addEventListener("wheel", handleWheel, { passive: false });
        doc.addEventListener("selectionchange", onSelectionChange);
        unbindDoc = () => {
          unbindPointer();
          doc.removeEventListener("keydown", handleKeyDown);
          doc.removeEventListener("wheel", handleWheel);
          doc.removeEventListener("selectionchange", onSelectionChange);
        };
      };
      el.addEventListener("load", handleLoad as EventListener);

      return () => {
        el.removeEventListener("relocate", handleRelocate as EventListener);
        el.removeEventListener("create-overlay", handleCreateOverlay as EventListener);
        el.removeEventListener("draw-annotation", handleDrawAnnotation as EventListener);
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
      currentChapterHrefRef.current = undefined;
      lastLocationRef.current = null;
      lastSelectionDocRef.current = null;
      paintedCfisRef.current = new Set();
      setSelectionPos(null);
      if (!fileData || !viewRef.current) return;
      const view = viewRef.current as unknown as {
        open: (file: File) => Promise<void>;
        init: (opts: Record<string, unknown>) => Promise<void>;
        goToFraction: (frac: number) => Promise<void>;
        close?: () => void;
      };
      const { bytes, name } = fileData;
      const file = new File([bytes], name);
      const fractionToRestore = initialFraction;
      // Close any previous renderer before opening a new book so foliate does
      // not stack multiple paginators in the shadow root (duplicate opens would
      // otherwise leave the visible renderer stale while paging hits the new one).
      view.close?.();
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

    useEffect(() => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (!view) return;
      const next = new Set(highlights.map((item) => item.cfi));
      for (const cfi of paintedCfisRef.current) {
        if (!next.has(cfi)) paintHighlight(view, cfi, true);
      }
      for (const highlight of highlights) {
        paintHighlight(view, highlight.cfi);
      }
      paintedCfisRef.current = next;
    }, [highlights]);

    const clearIframeSelection = useCallback(() => {
      lastSelectionDocRef.current?.getSelection()?.removeAllRanges();
      lastSelectionDocRef.current = null;
      setSelectionPos(null);
    }, []);

    const handleAskAgent = useCallback(() => {
      if (!selectionPos) return;
      const capture: SelectionCapture = {
        text: selectionPos.text,
        chapterHref: currentChapterHrefRef.current,
      };
      onSelectionCapture?.(capture);
      clearIframeSelection();
    }, [selectionPos, onSelectionCapture, clearIframeSelection]);

    const handleHighlightSelection = useCallback(() => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (!view) return;
      const selection = readIframeSelection(view);
      if (!selection) return;
      paintHighlight(view, selection.cfi);
      onHighlight?.(selection);
      clearIframeSelection();
    }, [onHighlight, clearIframeSelection]);

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
    const goToCfi = useCallback(async (cfi: string) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      try {
        const resolved = await view?.goTo?.(cfi);
        return resolved != null;
      } catch (err: unknown) {
        console.error("goToCfi error:", err);
        return false;
      }
    }, []);
    const setStyles = useCallback((css: string) => {
      const view = viewRef.current as unknown as { renderer?: { setStyles?: (c: string) => void } };
      view?.renderer?.setStyles?.(css);
    }, []);
    const getToc = useCallback((): TocItem[] => {
      const view = viewRef.current as unknown as { book?: { toc?: TocItem[] } };
      return view?.book?.toc ?? [];
    }, []);
    const getLocation = useCallback(() => lastLocationRef.current, []);
    const getSelectionCfi = useCallback(() => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      return view ? readIframeSelection(view) : null;
    }, []);
    const addHighlight = useCallback((cfi: string) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (view) paintHighlight(view, cfi);
    }, []);
    const removeHighlight = useCallback((cfi: string) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (view) paintHighlight(view, cfi, true);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        prev,
        next,
        goToFraction,
        goToTocItem,
        goToCfi,
        setStyles,
        getToc,
        getLocation,
        getSelectionCfi,
        addHighlight,
        removeHighlight,
      }),
      [
        prev,
        next,
        goToFraction,
        goToTocItem,
        goToCfi,
        setStyles,
        getToc,
        getLocation,
        getSelectionCfi,
        addHighlight,
        removeHighlight,
      ],
    );

    return (
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />

        {selectionPos && (
          <SelectionToolbar
            x={selectionPos.x}
            y={selectionPos.y}
            onHighlight={handleHighlightSelection}
            onAskAgent={handleAskAgent}
          />
        )}
      </div>
    );
  },
);
