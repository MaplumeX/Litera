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
  pageWidthOf,
  shouldIgnorePagingTarget,
  shouldIgnoreSpaceTarget,
  type WheelPagingState,
} from "@/lib/reader-paging";
import { sectionIndexAt } from "@/lib/reader-progress";
import { TTS_HIGHLIGHT_COLOR, TTS_OVERLAY_KEY } from "@/lib/reader-tts";
import { footnotePopupCss } from "@/lib/reader-styles";
import { SelectionToolbar } from "@/components/SelectionToolbar";
import { FootnotePopup } from "@/components/FootnotePopup";
import type { HighlightRecord } from "@/types/library";

// foliate.js view.js defines the <foliate-view> custom element.
// Importing the module registers it with the customElements registry.
import "../foliate-js/view.js";
import { FootnoteHandler } from "../foliate-js/footnotes.js";
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
  getSectionFractions: () => number[];
  previewLabelAt: (fraction: number) => string | undefined;
  goToCfi: (cfi: string) => Promise<boolean>;
  setStyles: (css: string) => void;
  getToc: () => TocItem[];
  getLocation: () => ReaderLocation | null;
  getSelectionCfi: () => SelectionCfi | null;
  addHighlight: (cfi: string) => void;
  removeHighlight: (cfi: string) => void;
  initTts: () => Promise<boolean>;
  ttsSpeakOrigin: (source?: "auto" | "visible") => string | undefined;
  ttsNext: () => string | undefined;
  ttsResume: () => string | undefined;
  ttsSetMark: (mark: string) => void;
  clearTtsHighlight: () => void;
  advanceTtsSection: () => Promise<string | undefined>;
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
  /** Space play/pause while the chapter iframe or window is focused. */
  onTtsToggle?: () => void;
  /** User-initiated relocate while TTS should resync from the new visible range. */
  onUserRelocate?: () => void;
  /** Reader CSS (font/theme) to inject into footnote popup inner views. */
  stylesCss?: string;
}

type FoliateOverlayer = {
  add(key: string, range: Range, draw: unknown, options?: { color?: string }): void;
  remove(key: string): void;
};

type FoliateTtsEngine = {
  doc: Document;
  start: () => string | undefined;
  resume: () => string | undefined;
  next: (paused?: boolean) => string | undefined;
  from: (range: Range) => string | undefined;
  setMark: (mark: string) => void;
};

type FoliateAnnotator = {
  getCFI?: (index: number, range?: Range) => string;
  addAnnotation?: (annotation: { value: string }, remove?: boolean) => Promise<unknown>;
  deleteAnnotation?: (annotation: { value: string }) => Promise<unknown>;
  goTo?: (target: string) => Promise<unknown>;
  tts?: FoliateTtsEngine | null;
  initTTS?: (granularity?: string, highlight?: (range: Range) => void) => Promise<void>;
  lastLocation?: { range?: Range } | null;
  next?: () => Promise<void>;
  renderer?: {
    getContents?: () => { index: number; doc?: Document; overlayer?: FoliateOverlayer }[];
    scrollToAnchor?: (anchor: Range | number, select?: boolean) => void | Promise<void>;
    nextSection?: () => Promise<void>;
  };
};

/** Inner <foliate-view> element created by FootnoteHandler for the popup. */
type FoliateInnerView = HTMLElement & {
  close?: () => void;
  goTo?: (href: string) => void;
  renderer?: HTMLElement & {
    setStyles?: (css: string) => void;
    viewSize?: number;
    getContents?: () => { doc?: Document }[];
  };
};

function isTtsRangeVisible(range: Range, visible?: Range): boolean {
  if (visible) {
    try {
      return (
        range.compareBoundaryPoints(Range.START_TO_END, visible) < 0 &&
        range.compareBoundaryPoints(Range.END_TO_START, visible) > 0
      );
    } catch {
      // detached ranges fall through to a viewport check
    }
  }
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const doc =
    range.startContainer.nodeType === Node.DOCUMENT_NODE
      ? (range.startContainer as Document)
      : range.startContainer.ownerDocument;
  const view = doc?.defaultView;
  if (!view) return true;
  return rect.bottom > 0 && rect.top < view.innerHeight && rect.right > 0 && rect.left < view.innerWidth;
}

function readIframeSelectionRange(view: FoliateAnnotator): Range | null {
  const contents = view.renderer?.getContents?.() ?? [];
  for (const { doc } of contents) {
    if (!doc) continue;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
    if (!sel.toString().trim()) continue;
    return sel.getRangeAt(0);
  }
  return null;
}

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
      onTtsToggle,
      onUserRelocate,
      stylesCss,
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
    const onTtsToggleRef = useRef(onTtsToggle);
    const onUserRelocateRef = useRef(onUserRelocate);
    onRelocateRef.current = onRelocate;
    onBookReadyRef.current = onBookReady;
    onTtsToggleRef.current = onTtsToggle;
    onUserRelocateRef.current = onUserRelocate;
    // Latest reader CSS for footnote inner views (read inside the mount effect).
    const stylesCssRef = useRef(stylesCss);
    stylesCssRef.current = stylesCss;
    const footnoteInnerViewRef = useRef<FoliateInnerView | null>(null);
    // True while a footnote popup is expected: set on a footnote hit, cleared on
    // close. Guards `before-render` against mounting an inner view for a
    // footnote the user already dismissed (e.g. Esc while the book was still
    // opening) — the view would otherwise linger in the hidden popup.
    const footnoteOpenRef = useRef(false);
    // Always-mounted mount point for the inner view (see FootnotePopup). The
    // popup wrapper stays in the DOM so this node exists when `before-render`
    // fires; the inner view is appended synchronously there, before foliate
    // runs `goTo` on it.
    const footnoteMountRef = useRef<HTMLDivElement | null>(null);
    const [footnotePos, setFootnotePos] = useState<{ x: number | null; y: number | null }>({
      x: null,
      y: null,
    });
    const [footnoteView, setFootnoteView] = useState<HTMLElement | null>(null);
    const [footnoteHeight, setFootnoteHeight] = useState<number | null>(null);

    // Close the footnote popup and destroy its inner view.
    const closeFootnote = useCallback(() => {
      footnoteOpenRef.current = false;
      const inner = footnoteInnerViewRef.current;
      if (inner) {
        footnoteInnerViewRef.current = null;
        inner.close?.();
        inner.remove();
      }
      setFootnotePos({ x: null, y: null });
      setFootnoteView(null);
      setFootnoteHeight(null);
    }, []);
    const ttsRangeRef = useRef<Range | null>(null);
    const suppressUserRelocateRef = useRef(0);
    const applyTtsHighlightRef = useRef<(range: Range) => void>(() => {});
    const stableTtsHighlight = useRef((range: Range) => {
      applyTtsHighlightRef.current(range);
    }).current;

    applyTtsHighlightRef.current = (range: Range) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      const contents = view?.renderer?.getContents?.()[0];
      const doc = contents?.doc;
      const rangeDoc =
        range.startContainer.nodeType === Node.DOCUMENT_NODE
          ? (range.startContainer as Document)
          : range.startContainer.ownerDocument;
      if (!contents || !doc) return;
      if (!rangeDoc || rangeDoc !== doc) {
        ttsRangeRef.current = null;
        return;
      }
      ttsRangeRef.current = range;
      if (contents.overlayer) {
        contents.overlayer.remove(TTS_OVERLAY_KEY);
        contents.overlayer.add(TTS_OVERLAY_KEY, range, Overlayer.highlight, {
          color: TTS_HIGHLIGHT_COLOR,
        });
      }
      if (isTtsRangeVisible(range, view?.lastLocation?.range)) return;
      suppressUserRelocateRef.current += 1;
      const done = () => {
        suppressUserRelocateRef.current = Math.max(0, suppressUserRelocateRef.current - 1);
      };
      void Promise.resolve(view?.renderer?.scrollToAnchor?.(range, false)).then(done, done);
    };
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
        if (suppressUserRelocateRef.current === 0) {
          onUserRelocateRef.current?.();
        }
      };
      el.addEventListener("relocate", handleRelocate as EventListener);

      const handleCreateOverlay = () => {
        const view = el as unknown as FoliateAnnotator;
        for (const highlight of highlightsRef.current) {
          paintHighlight(view, highlight.cfi);
        }
        if (ttsRangeRef.current) applyTtsHighlightRef.current(ttsRangeRef.current);
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
        if (ke.key === "Escape") {
          // The footnote popup listens on window, but keydown from the chapter
          // iframe never reaches it; close the popup here when focus is inside.
          if (footnoteOpenRef.current) {
            ke.preventDefault();
            closeFootnote();
          }
          return;
        }
        if (ke.key === " " || ke.code === "Space") {
          if (shouldIgnoreSpaceTarget(ke.target)) return;
          ke.preventDefault();
          onTtsToggleRef.current?.();
          return;
        }
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

      // --- Footnote popup ---
      const footnoteHandler = new FootnoteHandler();
      // Monotonic click counter: a before-render for an older click (async
      // `open(book)` can resolve out of order across rapid re-clicks) must not
      // replace the view of the newest click.
      let footnoteSeq = 0;
      const handleFootnoteBeforeRender = (e: Event, seq: number) => {
        const detail = (e as CustomEvent<{ view: FoliateInnerView }>).detail;
        const inner = detail.view;
        if (seq !== footnoteSeq) {
          // A newer footnote click superseded this one; discard its view.
          inner.close?.();
          inner.remove();
          return;
        }
        // Replace any previous inner view (rapid clicks on another footnote).
        const prevInner = footnoteInnerViewRef.current;
        if (prevInner && prevInner !== inner) {
          prevInner.close?.();
          prevInner.remove();
        }
        if (!footnoteOpenRef.current) {
          // The popup was dismissed while this footnote was still loading
          // (Esc / backdrop during `open(book)`); discard the inner view
          // instead of leaving it mounted in the hidden popup.
          footnoteInnerViewRef.current = null;
          inner.close?.();
          inner.remove();
          return;
        }
        footnoteInnerViewRef.current = inner;
        // The popup shows a scrollable footnote; use scrolled flow and zero margins.
        inner.style.display = "block";
        inner.style.width = "100%";
        inner.style.height = "100%";
        inner.style.background = "transparent";
        inner.renderer?.setAttribute?.("flow", "scrolled");
        inner.renderer?.setAttribute?.("margin", "0");
        const stylesCss = stylesCssRef.current;
        const overlay = footnotePopupCss();
        inner.renderer?.setStyles?.(stylesCss ? `${stylesCss}\n${overlay}` : overlay);
        // Append the inner view synchronously before foliate runs `goTo(index)`
        // (the paginator measures its container during layout).
        const mount = footnoteMountRef.current;
        if (mount && !mount.contains(inner)) mount.appendChild(inner);
        setFootnoteView(inner);
        // Links inside the footnote close the popup and let the main view
        // handle navigation (backlink returns to the reference, others jump).
        inner.addEventListener("link", ((linkEvent) => {
          const href = (linkEvent as CustomEvent<{ href: string }>).detail?.href;
          linkEvent.preventDefault();
          closeFootnote();
          if (href) {
            void (el as unknown as { goTo?: (h: string) => Promise<unknown> })
              .goTo?.(href);
          }
        }) as EventListener);
        // External links inside the footnote: close and open externally,
        // mirroring the main view's default external-link behavior. The detail
        // carries the raw `href_` attribute (view.js #handleLinks).
        inner.addEventListener("external-link", ((linkEvent) => {
          const href = (linkEvent as CustomEvent<{ href_?: string }>).detail?.href_;
          linkEvent.preventDefault();
          closeFootnote();
          if (href) globalThis.open(href, "_blank");
        }) as EventListener);
        // Esc must close the popup even when the footnote iframe has focus
        // (iframe keydown does not reach the parent window).
        inner.addEventListener("load", ((loadEvent) => {
          const doc = (loadEvent as CustomEvent<{ doc?: Document }>).detail?.doc;
          doc?.addEventListener("keydown", (keyEvent) => {
            const ke = keyEvent as KeyboardEvent;
            if (ke.key !== "Escape") return;
            ke.preventDefault();
            closeFootnote();
          });
        }) as EventListener);
        // The `render` event fires before the paginator lays out and scrolls to
        // the fragment, so measure the content height only after `relocate`.
        inner.addEventListener("relocate", (() => {
          const viewSize = inner.renderer?.viewSize;
          const fallback = inner.renderer
            ?.getContents?.()?.[0]
            ?.doc?.body?.getBoundingClientRect().height;
          const h = typeof viewSize === "number" && viewSize > 0 ? viewSize : fallback;
          if (typeof h !== "number" || !(h > 0)) return;
          const rounded = Math.round(h);
          setFootnoteHeight((prev) => (prev === rounded ? prev : rounded));
        }) as EventListener);
      };
      // One-shot before-render listener per click: captures the click's seq so
      // an out-of-order arrival can be detected (see handleFootnoteBeforeRender).
      // Only registered for footnote hits; disposed on rejection via `dispose`.
      const footnoteClick = (e: Event): {
        promise: Promise<unknown>;
        dispose: () => void;
      } | undefined => {
        const view = el as unknown as { book?: unknown };
        if (!view.book) return undefined;
        let result: Promise<unknown> | undefined;
        try {
          result = footnoteHandler.handle(view.book, e);
        } catch (err: unknown) {
          console.error("footnote handler error:", err);
          return undefined;
        }
        if (!result) return undefined; // not a footnote — nothing pending
        const seq = ++footnoteSeq;
        const onBeforeRender = (ev: Event) => {
          footnoteHandler.removeEventListener("before-render", onBeforeRender);
          handleFootnoteBeforeRender(ev, seq);
        };
        footnoteHandler.addEventListener("before-render", onBeforeRender);
        return {
          promise: result,
          dispose: () => footnoteHandler.removeEventListener("before-render", onBeforeRender),
        };
      };
      const handleLink = (e: Event) => {
        const hit = footnoteClick(e);
        if (hit) {
          // Footnote hit: expect a popup (cleared again by closeFootnote), so a
          // late before-render mounts its inner view. Show the popup
          // immediately at the clicked reference.
          footnoteOpenRef.current = true;
          // `a` lives inside the chapter iframe, so test nodeType (realm-safe)
          // instead of `instanceof Element`.
          const detail = (e as CustomEvent<{ a?: unknown }>).detail;
          const a = detail.a as
            | {
                nodeType?: number;
                getBoundingClientRect?: () => DOMRect;
                ownerDocument?: Document;
              }
            | null
            | undefined;
          if (a?.nodeType === 1 && a.getBoundingClientRect) {
            const rect = a.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
              const doc = a.ownerDocument;
              const frame = doc?.defaultView?.frameElement;
              const offset = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
              setFootnotePos({
                x: offset.left + rect.left + rect.width / 2,
                y: offset.top + rect.bottom,
              });
            }
          }
          void hit.promise.catch((err: unknown) => {
            console.error("footnote handler error:", err);
            // A failed footnote load must not leave a stale popup open or a
            // pending one-shot before-render listener behind.
            hit.dispose();
            closeFootnote();
          });
        }
      };
      el.addEventListener("link", handleLink as EventListener);

      return () => {
        el.removeEventListener("relocate", handleRelocate as EventListener);
        el.removeEventListener("create-overlay", handleCreateOverlay as EventListener);
        el.removeEventListener("draw-annotation", handleDrawAnnotation as EventListener);
        el.removeEventListener("load", handleLoad as EventListener);
        el.removeEventListener("link", handleLink as EventListener);
        closeFootnote();
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
      ttsRangeRef.current = null;
      suppressUserRelocateRef.current = 0;
      paintedCfisRef.current = new Set();
      setSelectionPos(null);
      closeFootnote();
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
    const getSectionFractions = useCallback((): number[] => {
      const view = viewRef.current as unknown as { getSectionFractions?: () => number[] };
      return view?.getSectionFractions?.() ?? [];
    }, []);
    const previewLabelAt = useCallback((fraction: number): string | undefined => {
      const view = viewRef.current as unknown as {
        getSectionFractions?: () => number[];
        getProgressOf?: (index: number) => { tocItem?: { label?: string } };
      };
      if (!view) return undefined;
      const index = sectionIndexAt(fraction, view.getSectionFractions?.() ?? []);
      if (index == null) return undefined;
      const label = view.getProgressOf?.(index)?.tocItem?.label;
      return label || undefined;
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

    const clearTtsHighlight = useCallback(() => {
      ttsRangeRef.current = null;
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      view?.renderer?.getContents?.()[0]?.overlayer?.remove(TTS_OVERLAY_KEY);
    }, []);

    const initTts = useCallback(async () => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      const doc = view?.renderer?.getContents?.()[0]?.doc;
      if (!view?.initTTS || !doc) return false;
      await view.initTTS("sentence", stableTtsHighlight);
      return Boolean(view.tts);
    }, [stableTtsHighlight]);

    const ttsSpeakOrigin = useCallback((source: "auto" | "visible" = "auto") => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (!view?.tts) return undefined;
      if (source !== "visible") {
        const selection = readIframeSelectionRange(view);
        if (selection) return view.tts.from(selection);
      }
      const visible = view.lastLocation?.range;
      if (visible) return view.tts.from(visible);
      return view.tts.start();
    }, []);

    const ttsNext = useCallback(() => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      return view?.tts?.next();
    }, []);

    const ttsResume = useCallback(() => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      return view?.tts?.resume();
    }, []);

    const ttsSetMark = useCallback((mark: string) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      view?.tts?.setMark(mark);
    }, []);

    const advanceTtsSection = useCallback(async () => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (!view) return undefined;
      const before = view.renderer?.getContents?.()[0]?.doc;
      clearTtsHighlight();
      suppressUserRelocateRef.current += 1;
      try {
        if (view.renderer?.nextSection) await view.renderer.nextSection();
        else await view.next?.();
        const after = view.renderer?.getContents?.()[0]?.doc;
        if (!after || after === before) return undefined;
        const ok = await initTts();
        const tts = view.tts;
        if (!ok || !tts) return undefined;
        return tts.start();
      } finally {
        suppressUserRelocateRef.current = Math.max(0, suppressUserRelocateRef.current - 1);
      }
    }, [clearTtsHighlight, initTts]);

    useImperativeHandle(
      ref,
      () => ({
        prev,
        next,
        goToFraction,
        goToTocItem,
        getSectionFractions,
        previewLabelAt,
        goToCfi,
        setStyles,
        getToc,
        getLocation,
        getSelectionCfi,
        addHighlight,
        removeHighlight,
        initTts,
        ttsSpeakOrigin,
        ttsNext,
        ttsResume,
        ttsSetMark,
        clearTtsHighlight,
        advanceTtsSection,
      }),
      [
        prev,
        next,
        goToFraction,
        goToTocItem,
        getSectionFractions,
        previewLabelAt,
        goToCfi,
        setStyles,
        getToc,
        getLocation,
        getSelectionCfi,
        addHighlight,
        removeHighlight,
        initTts,
        ttsSpeakOrigin,
        ttsNext,
        ttsResume,
        ttsSetMark,
        clearTtsHighlight,
        advanceTtsSection,
      ],
    );

    return (
      <div data-testid="reader-view" className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />

        {selectionPos && (
          <SelectionToolbar
            x={selectionPos.x}
            y={selectionPos.y}
            onHighlight={handleHighlightSelection}
            onAskAgent={handleAskAgent}
          />
        )}

        <FootnotePopup
          x={footnotePos.x}
          y={footnotePos.y}
          height={footnoteHeight}
          viewElement={footnoteView}
          mountRef={footnoteMountRef}
          onClose={closeFootnote}
        />
      </div>
    );
  },
);
