import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  bindPointerPaging,
  consumeWheelDelta,
  hitFromClientX,
  isFindShortcut,
  isSeekBurst,
  pageLocalX,
  pageWidthOf,
  bindTapTouchGuard,
  isScrollKeyAction,
  readerKeyAction,
  READ_ON_SCREENS,
  screensBetween,
  scrollAreaAt,
  scrolledBoundaryDirection,
  type ReaderKeyAction,
  type ReadingMark,
  type WheelPagingState,
} from "@/lib/reader-paging";
import type { ReaderFlow } from "@/lib/reader-flow";
import { hideUntilFontsReady } from "@/lib/reader-font-gate";
import { opensImageViewer, readerImageAt, type ReaderImage } from "@/lib/reader-images";
import {
  QUOTE_FLASH_MS,
  QUOTE_HIGHLIGHT_COLOR,
  QUOTE_OVERLAY_KEY,
  quoteSearchQueries,
} from "@/lib/citations";
import { chapterTicks, sectionIndexAt } from "@/lib/reader-progress";
import { parseXPointer, rangeFromXPointer, xpointerFromRange } from "@/lib/xpointer";
import { TTS_HIGHLIGHT_COLOR, TTS_OVERLAY_KEY } from "@/lib/reader-tts";
import { clampSnap, footnotePopupCss, TYPOGRAPHY_RANGES } from "@/lib/reader-styles";
import { platformBridge } from "@/lib/platform-bridge";
import {
  getLastUsedHighlightColor,
  highlightColorHex,
  isHighlightOverlayKey,
  resolveHighlightColor,
  setLastUsedHighlightColor,
} from "@/lib/annotations";
import { SelectionToolbar } from "@/components/SelectionToolbar";
import { HighlightEditor } from "@/components/HighlightEditor";
import { FootnotePopup } from "@/components/FootnotePopup";
import { ImageViewer } from "@/components/ImageViewer";
import type { HighlightColor, HighlightRecord } from "@/types/library";

// foliate.js view.js defines the <foliate-view> custom element.
// Importing the module registers it with the customElements registry.
import "../foliate-js/view.js";
import { FootnoteHandler } from "../foliate-js/footnotes.js";
import { Overlayer } from "../foliate-js/overlayer.js";

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

export interface ReaderHistoryState {
  canGoBack: boolean;
  canGoForward: boolean;
  /** The reader has read on past the last jump, so back / forward step out of sight (Alt+←/→ still work). */
  readOn: boolean;
}

/** Renderer relocations that come from reading on, not from a jump landing. */
const READING_REASONS = new Set(["page", "snap", "scroll"]);

/** Lines scrolled per ↑/↓ press in scrolled flow. */
const SCROLL_LINE_PX = 80;

type FoliateHistory = EventTarget & {
  back: () => void;
  forward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  clear: () => void;
  pushState: (state: unknown) => void;
  replaceState: (state: unknown) => void;
};

type FoliateRenderer = EventTarget & {
  scrolled?: boolean;
  start?: number;
  size?: number;
  page?: number;
};

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
  /** Go to a chapter the way a page turn goes on: the way back stays where the last jump started. */
  turnToChapter: (href: string) => Promise<void>;
  /** Chapter start fractions plus a trailing 1, one per TOC entry rather than per spine file. */
  getChapterTicks: () => number[];
  previewLabelAt: (fraction: number) => string | undefined;
  goToCfi: (cfi: string) => Promise<boolean>;
  /** Go to a quoted sentence in the chapter at `href` and outline it; falls back to the chapter start. */
  goToQuote: (href: string, quote: string) => Promise<boolean>;
  setStyles: (css: string) => void;
  setColumnCount: (count: number) => void;
  setFlow: (flow: ReaderFlow) => void;
  /** Return to where the last jump (link, TOC, search hit, seek) started. */
  goBack: () => void;
  goForward: () => void;
  /** Whole-book search; foliate outlines every match until `clearSearch`. */
  searchBook: (query: string) => AsyncIterator<unknown> | null;
  clearSearch: () => void;
  getToc: () => TocItem[];
  getLocation: () => ReaderLocation | null;
  /** KOReader XPointer of the visible position, for KOReader Sync. */
  getXPointer: () => string | null;
  /** Go to a KOReader XPointer; falls back to `fallbackFraction` when it does not resolve. */
  goToXPointer: (xpointer: string, fallbackFraction: number) => Promise<void>;
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
  /**
   * Close the selection toolbar or the highlight editor, whichever is up;
   * false when neither was (the mobile shell's Back moves on to the next layer).
   */
  dismissSelection: () => boolean;
  /** Whether `dismissSelection` would close something (Back's preview asks first). */
  hasSelection: () => boolean;
  /**
   * Keep the selection's start in view through the next resize, in place of
   * the page's start (the mobile shell shrinks the page to open the assistant).
   */
  anchorToSelection: () => void;
}

interface ReaderViewProps {
  /** Bytes of an opened EPUB file, or null when no file is loaded. */
  fileData: { bytes: Uint8Array<ArrayBuffer>; name: string } | null;
  /** Called when the reader relocates (page turn / scroll). */
  onRelocate?: (
    index: number,
    fraction: number,
    label?: string,
    chapterHref?: string,
    cfi?: string,
  ) => void;
  /** Called when the user clicks the ask-agent button on a selection. */
  onSelectionCapture?: (capture: SelectionCapture) => void;
  /** Called when the user clicks highlight on a selection. */
  onHighlight?: (selection: SelectionCfi) => void;
  /** Called when the in-page editor changes color or note. */
  onUpdateHighlight?: (id: string, patch: { color?: HighlightColor; note?: string | null }) => void;
  /** Called when the in-page editor deletes a highlight. */
  onDeleteHighlight?: (id: string) => void;
  /** Highlights to paint on create-overlay / after snapshot load. */
  highlights?: HighlightRecord[];
  /** Last reading fraction to restore (0-1), from library persistence. */
  initialFraction?: number;
  /** Last visible CFI to restore; takes precedence over initialFraction. */
  initialCfi?: string;
  /** Called after the book is opened and toc is available. */
  onBookReady?: (toc: TocItem[]) => void;
  /** Space play/pause while read-aloud is active (see `ttsActive`). */
  onTtsToggle?: () => void;
  /** Read-aloud is playing or paused: Space toggles it instead of turning the page. */
  ttsActive?: boolean;
  /** Back / forward availability after each navigation. */
  onHistoryChange?: (state: ReaderHistoryState) => void;
  /** Ctrl/⌘+F pressed while the chapter has focus. */
  onFindRequest?: () => void;
  /** The Book pane is hidden: keys must not move a book nobody can see. */
  keysDisabled?: boolean;
  /** User-initiated relocate while TTS should resync from the new visible range. */
  onUserRelocate?: () => void;
  /** Reader CSS (font/theme) to inject into footnote popup inner views. */
  stylesCss?: string;
  /** A blank tap in the middle third of the page (the mobile shell toggles its chrome). */
  onMiddleTap?: () => void;
}

type FoliateOverlayer = {
  add(key: string, range: Range, draw: unknown, options?: { color?: string }): void;
  remove(key: string): void;
  hitTest?(point: { x: number; y: number }): [string, Range] | [] | undefined;
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
  addAnnotation?: (
    annotation: { value: string; color?: string },
    remove?: boolean,
  ) => Promise<unknown>;
  deleteAnnotation?: (annotation: { value: string }) => Promise<unknown>;
  goTo?: (target: string) => Promise<unknown>;
  clearSearch?: () => void;
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

function paintHighlight(view: FoliateAnnotator, cfi: string, color?: string, remove = false) {
  const task = remove
    ? view.deleteAnnotation?.({ value: cfi })
    : view.addAnnotation?.({ value: cfi, color });
  void Promise.resolve(task).catch((err: unknown) =>
    console.error(remove ? "deleteAnnotation error:" : "addAnnotation error:", err),
  );
}

function rangeOwnerDocument(range: Range): Document | null {
  return range.startContainer.nodeType === Node.DOCUMENT_NODE
    ? (range.startContainer as Document)
    : range.startContainer.ownerDocument;
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
      onUpdateHighlight,
      onDeleteHighlight,
      highlights = [],
      initialFraction,
      initialCfi,
      onBookReady,
      onTtsToggle,
      ttsActive = false,
      onHistoryChange,
      onFindRequest,
      keysDisabled = false,
      onUserRelocate,
      stylesCss,
      onMiddleTap,
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
    const ttsActiveRef = useRef(ttsActive);
    ttsActiveRef.current = ttsActive;
    const onHistoryChangeRef = useRef(onHistoryChange);
    onHistoryChangeRef.current = onHistoryChange;
    const onFindRequestRef = useRef(onFindRequest);
    onFindRequestRef.current = onFindRequest;
    const keysDisabledRef = useRef(keysDisabled);
    keysDisabledRef.current = keysDisabled;
    // Scrolled flow: native scrolling, no tap zones, ↑/↓ scroll by lines.
    const scrolledRef = useRef(false);
    // Last progress-bar seek, so a burst of seeks is one history entry.
    const lastSeekAtRef = useRef(0);
    // Screens read since the last jump; past READ_ON_SCREENS the back /
    // forward controls step aside.
    const readOnRef = useRef<{ mark: ReadingMark | null; screens: number; readOn: boolean }>({
      mark: null,
      screens: 0,
      readOn: false,
    });
    const emitHistory = useCallback(() => {
      const history = (viewRef.current as unknown as { history?: FoliateHistory } | null)?.history;
      onHistoryChangeRef.current?.({
        canGoBack: history?.canGoBack ?? false,
        canGoForward: history?.canGoForward ?? false,
        readOn: readOnRef.current.readOn,
      });
    }, []);
    const addReadOnScreens = useCallback((screens: number) => {
      const state = readOnRef.current;
      if (state.readOn) return;
      state.screens += screens;
      if (state.screens < READ_ON_SCREENS) return;
      state.readOn = true;
      emitHistory();
    }, [emitHistory]);
    const [image, setImage] = useState<ReaderImage | null>(null);
    // Latest reader CSS for footnote inner views (read inside the mount effect).
    const stylesCssRef = useRef(stylesCss);
    stylesCssRef.current = stylesCss;
    const onMiddleTapRef = useRef(onMiddleTap);
    onMiddleTapRef.current = onMiddleTap;
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
    const quoteFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearQuoteFlash = useCallback(() => {
      if (quoteFlashTimerRef.current) clearTimeout(quoteFlashTimerRef.current);
      quoteFlashTimerRef.current = null;
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      for (const { overlayer } of view?.renderer?.getContents?.() ?? []) {
        overlayer?.remove(QUOTE_OVERLAY_KEY);
      }
    }, []);
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
    const [editor, setEditor] = useState<{
      id: string;
      cfi: string;
      x: number;
      y: number;
      color: HighlightColor;
      note: string;
    } | null>(null);
    const closeHighlightEditorRef = useRef(() => {});
    const closeHighlightEditor = useCallback(() => setEditor(null), []);
    closeHighlightEditorRef.current = closeHighlightEditor;
    const onUpdateHighlightRef = useRef(onUpdateHighlight);
    const onDeleteHighlightRef = useRef(onDeleteHighlight);
    onUpdateHighlightRef.current = onUpdateHighlight;
    onDeleteHighlightRef.current = onDeleteHighlight;

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
        onRelocateRef.current?.(index, fraction, label, chapterHref, detail.cfi);
        if (suppressUserRelocateRef.current === 0) {
          onUserRelocateRef.current?.();
        }
      };
      el.addEventListener("relocate", handleRelocate as EventListener);

      const handleCreateOverlay = () => {
        const view = el as unknown as FoliateAnnotator;
        for (const highlight of highlightsRef.current) {
          paintHighlight(view, highlight.cfi, highlightColorHex(highlight.color));
        }
        if (ttsRangeRef.current) applyTtsHighlightRef.current(ttsRangeRef.current);
      };
      const handleDrawAnnotation = (e: Event) => {
        const detail = (
          e as CustomEvent<{
            draw?: (fn: unknown, opts: { color: string }) => void;
            annotation?: { color?: string };
          }>
        ).detail;
        const color = detail.annotation?.color ?? highlightColorHex();
        detail.draw?.(Overlayer.highlight, { color });
      };
      const handleShowAnnotation = (e: Event) => {
        const detail = (
          e as CustomEvent<{ value?: string; range?: Range }>
        ).detail;
        if (!isHighlightOverlayKey(detail?.value)) return;
        const highlight = highlightsRef.current.find((item) => item.cfi === detail.value);
        if (!highlight || !detail.range) return;
        const doc = rangeOwnerDocument(detail.range);
        if (!doc) return;
        const pos = selectionOverlayPos(doc, detail.range);
        if (!pos) return;
        setSelectionPos(null);
        setEditor({
          id: highlight.id,
          cfi: highlight.cfi,
          x: pos.x,
          y: pos.y,
          color: resolveHighlightColor(highlight.color),
          note: highlight.note ?? "",
        });
      };
      el.addEventListener("create-overlay", handleCreateOverlay as EventListener);
      el.addEventListener("draw-annotation", handleDrawAnnotation as EventListener);
      el.addEventListener("show-annotation", handleShowAnnotation as EventListener);

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
        const delta = Math.abs(we.deltaX) > Math.abs(we.deltaY) ? we.deltaX : we.deltaY;
        const now = we.timeStamp || Date.now();
        if (scrolledRef.current) {
          // Native scrolling inside the section; only a push past its end
          // (or start) moves on to the neighbouring section.
          const renderer = (el as unknown as {
            renderer?: { start?: number; size?: number; viewSize?: number };
          }).renderer;
          const dir = scrolledBoundaryDirection(we.deltaY, {
            start: renderer?.start ?? 0,
            size: renderer?.size ?? 0,
            viewSize: renderer?.viewSize ?? 0,
          });
          if (dir === 0) {
            wheelState = { accumulated: 0, lastTime: now, flipped: false };
            return;
          }
          we.preventDefault();
          const result = consumeWheelDelta(wheelState, we.deltaY, now, we.deltaMode);
          wheelState = result.state;
          if (result.turn === dir) {
            if (dir === 1) pageNext();
            else pagePrev();
          }
          return;
        }
        we.preventDefault();
        const result = consumeWheelDelta(wheelState, delta, now, we.deltaMode);
        wheelState = result.state;
        if (result.turn === 1) pageNext();
        else if (result.turn === -1) pagePrev();
      };

      type FoliateNav = {
        history?: FoliateHistory;
        goToFraction?: (frac: number) => Promise<void>;
        renderer?: { prev?: (distance?: number) => Promise<void>; next?: (distance?: number) => Promise<void> };
      };
      const runKeyAction = (action: ReaderKeyAction) => {
        const view = el as unknown as FoliateNav;
        switch (action) {
          case "left":
            pageLeft();
            break;
          case "right":
            pageRight();
            break;
          case "prev":
            pagePrev();
            break;
          case "next":
            pageNext();
            break;
          case "lineUp":
            void view.renderer?.prev?.(SCROLL_LINE_PX);
            break;
          case "lineDown":
            void view.renderer?.next?.(SCROLL_LINE_PX);
            break;
          case "start":
            void view.goToFraction?.(0);
            break;
          case "end":
            void view.goToFraction?.(1);
            break;
          case "back":
            view.history?.back();
            break;
          case "forward":
            view.history?.forward();
            break;
          case "ttsToggle":
            onTtsToggleRef.current?.();
            break;
        }
      };

      // Last scroll area outside the Book the reader pressed in (chat
      // transcript, side panel list); cleared by a press in the Book.
      let lastScrollArea: Element | null = null;
      // Touches inside a chapter never reach this window, so this only sees
      // the rest of the app (assistant chat, inputs): keep the native menu.
      const handleWindowPointerDown = (e: Event) => {
        lastScrollArea = scrollAreaAt(e.target, el);
        platformBridge.setSelectionMenuHidden(false);
      };
      const handleKeyDown = (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.defaultPrevented) return;
        if (ke.key === "Escape" && !(ke.altKey || ke.metaKey || ke.ctrlKey || ke.shiftKey)) {
          // The footnote popup listens on window, but keydown from the chapter
          // iframe never reaches it; close the popup here when focus is inside.
          closeHighlightEditorRef.current();
          if (footnoteOpenRef.current) {
            ke.preventDefault();
            closeFootnote();
          }
          return;
        }
        if (keysDisabledRef.current) return;
        const action = readerKeyAction(ke, {
          scrolled: scrolledRef.current,
          ttsActive: ttsActiveRef.current,
        });
        if (!action) return;
        // Unfocused keys after a press in another scroll area scroll that area.
        const unfocused = ke.target === document.body || ke.target === document;
        if (unfocused && isScrollKeyAction(action) && lastScrollArea?.isConnected) return;
        ke.preventDefault();
        runKeyAction(action);
      };
      // Keys typed in the chapter never reach the window, so the find
      // shortcut is forwarded from there; the window case is the App's.
      const handleDocKeyDown = (e: Event) => {
        const ke = e as KeyboardEvent;
        if (!ke.defaultPrevented && isFindShortcut(ke)) {
          ke.preventDefault();
          onFindRequestRef.current?.();
          return;
        }
        handleKeyDown(e);
      };

      // Tap zones only page in paginated flow; scrolled flow scrolls.
      const tapLeft = () => {
        if (!scrolledRef.current) pageLeft();
      };
      const tapRight = () => {
        if (!scrolledRef.current) pageRight();
      };
      const unbindHostPointer = bindPointerPaging(
        el,
        (ev) => ev.clientX - el.getBoundingClientRect().left,
        () => el.clientWidth,
        () => window.getSelection(),
        tapLeft,
        tapRight,
        {
          onIdlePointerUp: () => closeHighlightEditorRef.current(),
          onMiddleTap: () => onMiddleTapRef.current?.(),
        },
      );
      // Touches on the page margins reach the paginator through the host;
      // touches on the text through the chapter's window (bound per load).
      const unbindHostTouchGuard = bindTapTouchGuard(el, () => !scrolledRef.current);
      el.addEventListener("wheel", handleWheel, { passive: false });
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("pointerdown", handleWindowPointerDown, true);

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
        closeHighlightEditorRef.current();
        setSelectionPos({ x: pos.x, y: pos.y, text });
      };
      const handleLoad = (e: Event) => {
        unbindDoc?.();
        unbindDoc = undefined;
        const doc = (e as CustomEvent<{ doc?: Document }>).detail?.doc;
        if (!doc) return;
        void hideUntilFontsReady(doc);
        const unbindPointer = bindPointerPaging(
          doc,
          (ev) => pageLocalX(ev.clientX, pageWidthOf(doc)),
          () => pageWidthOf(doc),
          () => doc.getSelection(),
          tapLeft,
          tapRight,
          {
            shouldIgnore: (ev) => {
              const contents =
                (el as unknown as FoliateAnnotator).renderer?.getContents?.() ?? [];
              for (const { overlayer } of contents) {
                const hit = overlayer?.hitTest?.({ x: ev.clientX, y: ev.clientY });
                if (isHighlightOverlayKey(hit?.[0])) return true;
              }
              const picture = readerImageAt(ev.target);
              if (
                picture &&
                opensImageViewer({
                  scrolled: scrolledRef.current,
                  zone: hitFromClientX(
                    pageLocalX(ev.clientX, pageWidthOf(doc)),
                    pageWidthOf(doc),
                  ),
                  imageHeight: picture.height,
                  pageHeight: doc.defaultView?.innerHeight ?? 0,
                })
              ) {
                closeHighlightEditorRef.current();
                setImage(picture.image);
                return true;
              }
              return false;
            },
            onIdlePointerUp: () => closeHighlightEditorRef.current(),
            onMiddleTap: () => onMiddleTapRef.current?.(),
          },
        );
        const win = doc.defaultView;
        const unbindTouchGuard = win
          ? bindTapTouchGuard(win, () => !scrolledRef.current)
          : undefined;
        const onSelectionChange = () => handleIframeSelection(doc);
        const onDocPointerDown = () => {
          lastScrollArea = null;
          // Selections here get the SelectionToolbar instead.
          platformBridge.setSelectionMenuHidden(true);
        };
        doc.addEventListener("pointerdown", onDocPointerDown);
        doc.addEventListener("keydown", handleDocKeyDown);
        doc.addEventListener("wheel", handleWheel, { passive: false });
        doc.addEventListener("selectionchange", onSelectionChange);
        unbindDoc = () => {
          unbindPointer();
          unbindTouchGuard?.();
          doc.removeEventListener("keydown", handleDocKeyDown);
          doc.removeEventListener("pointerdown", onDocPointerDown);
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
          // No SelectionToolbar in the footnote: keep the native menu there.
          doc?.addEventListener("pointerdown", () => {
            platformBridge.setSelectionMenuHidden(false);
          });
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
          // Ceil so sub-pixel fractions never leave the content a hair taller
          // than the popup (the inner scrolled container has overflow: auto,
          // so a 1px deficit shows a permanent scrollbar).
          const rounded = Math.ceil(h);
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

      const history = (el as unknown as { history?: FoliateHistory }).history;
      const handleHistoryChange = () => {
        if (!history) return;
        readOnRef.current.screens = 0;
        readOnRef.current.readOn = false;
        emitHistory();
      };
      history?.addEventListener?.("index-change", handleHistoryChange);

      return () => {
        history?.removeEventListener?.("index-change", handleHistoryChange);
        el.removeEventListener("relocate", handleRelocate as EventListener);
        el.removeEventListener("create-overlay", handleCreateOverlay as EventListener);
        el.removeEventListener("draw-annotation", handleDrawAnnotation as EventListener);
        el.removeEventListener("show-annotation", handleShowAnnotation as EventListener);
        el.removeEventListener("load", handleLoad as EventListener);
        el.removeEventListener("link", handleLink as EventListener);
        if (quoteFlashTimerRef.current) clearTimeout(quoteFlashTimerRef.current);
        closeFootnote();
        unbindDoc?.();
        unbindHostPointer();
        unbindHostTouchGuard();
        el.removeEventListener("wheel", handleWheel);
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("pointerdown", handleWindowPointerDown, true);
        platformBridge.setSelectionMenuHidden(false);
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
      clearQuoteFlash();
      suppressUserRelocateRef.current = 0;
      paintedCfisRef.current = new Set();
      setSelectionPos(null);
      setEditor(null);
      setImage(null);
      closeFootnote();
      lastSeekAtRef.current = 0;
      readOnRef.current = { mark: null, screens: 0, readOn: false };
      onHistoryChangeRef.current?.({ canGoBack: false, canGoForward: false, readOn: false });
      if (!fileData || !viewRef.current) return;
      let disposed = false;
      let renderer: FoliateRenderer | null = null;
      // The renderer's relocate carries why it moved; the view's does not.
      const handleRendererRelocate = (e: Event) => {
        const detail = (e as CustomEvent<{ reason?: string; index?: number }>).detail;
        const r = e.currentTarget as FoliateRenderer;
        const mark = {
          index: detail?.index ?? 0,
          screen: r.scrolled ? (r.start ?? 0) / (r.size || 1) : (r.page ?? 0),
        };
        const from = readOnRef.current.mark;
        readOnRef.current.mark = mark;
        if (from && READING_REASONS.has(detail?.reason ?? "")) {
          addReadOnScreens(screensBetween(from, mark));
        }
      };
      const view = viewRef.current as unknown as {
        open: (file: File) => Promise<void>;
        init: (opts: Record<string, unknown>) => Promise<void>;
        goToFraction: (frac: number) => Promise<void>;
        resolveNavigation?: (target: string) => unknown;
        close?: () => void;
      };
      const { bytes, name } = fileData;
      const file = new File([bytes], name);
      const fractionToRestore = initialFraction;
      const cfiToRestore = initialCfi;
      // Close any previous renderer before opening a new book so foliate does
      // not stack multiple paginators in the shadow root (duplicate opens would
      // otherwise leave the visible renderer stale while paging hits the new one).
      view.close?.();
      view
        .open(file)
        .then(async () => {
          // Style the fresh renderer before init renders the first section;
          // otherwise that section shows the book's own fonts until onBookReady.
          const css = stylesCssRef.current;
          if (css) {
            (view as unknown as { renderer?: { setStyles?: (c: string) => void } })
              .renderer?.setStyles?.(css);
          }
          const restoreFraction = async () => {
            if (fractionToRestore != null && fractionToRestore > 0) {
              await view.goToFraction(fractionToRestore).catch((err: unknown) =>
                console.error("foliate goToFraction error:", err),
              );
            }
          };
          try {
            if (cfiToRestore) {
              const resolved = view.resolveNavigation?.(cfiToRestore);
              if (resolved) {
                // Do not init({}) then goTo(cfi): init without lastLocation calls next().
                await view.init({ lastLocation: cfiToRestore });
              } else {
                await view.init({});
                await restoreFraction();
              }
            } else {
              await view.init({});
              await restoreFraction();
            }
          } catch (err: unknown) {
            console.error("foliate restore error:", err);
            await restoreFraction();
          }
          // Restoring may take two navigations (init, then the saved
          // fraction); the reader has not jumped anywhere yet, so start the
          // history at the restored position with nothing to go back to.
          const history = (view as unknown as { history?: FoliateHistory }).history;
          if (history?.canGoBack) {
            const at = (view as unknown as { lastLocation?: { cfi?: string } }).lastLocation?.cfi;
            history.clear();
            history.pushState(at ?? { fraction: fractionToRestore ?? 0 });
          }
          emitHistory();
          if (!disposed) {
            renderer = (view as unknown as { renderer?: FoliateRenderer }).renderer ?? null;
            renderer?.addEventListener?.("relocate", handleRendererRelocate);
          }
          // Notify App that the book is ready and toc is available.
          const book = (view as unknown as { book?: { toc?: TocItem[] } }).book;
          onBookReadyRef.current?.(book?.toc ?? []);
        })
        .catch((err: unknown) => console.error("foliate open error:", err));
      return () => {
        disposed = true;
        renderer?.removeEventListener?.("relocate", handleRendererRelocate);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileData, initialFraction, initialCfi]);

    useEffect(() => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (!view) return;
      const next = new Set(highlights.map((item) => item.cfi));
      for (const cfi of paintedCfisRef.current) {
        if (!next.has(cfi)) paintHighlight(view, cfi, undefined, true);
      }
      for (const highlight of highlights) {
        paintHighlight(view, highlight.cfi, highlightColorHex(highlight.color));
      }
      paintedCfisRef.current = next;
      setEditor((current) => {
        if (!current) return current;
        return highlights.some((item) => item.id === current.id) ? current : null;
      });
    }, [highlights]);

    const clearIframeSelection = useCallback(() => {
      lastSelectionDocRef.current?.getSelection()?.removeAllRanges();
      lastSelectionDocRef.current = null;
      setSelectionPos(null);
    }, []);

    useEffect(() => {
      if (!editor) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeHighlightEditor();
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [editor, closeHighlightEditor]);

    const handleAskAgent = useCallback(() => {
      if (!selectionPos) return;
      const capture: SelectionCapture = {
        text: selectionPos.text,
        chapterHref: currentChapterHrefRef.current,
      };
      onSelectionCapture?.(capture);
      clearIframeSelection();
    }, [selectionPos, onSelectionCapture, clearIframeSelection]);

    const handleCopySelection = useCallback(() => {
      if (!selectionPos) return;
      void navigator.clipboard.writeText(selectionPos.text);
      clearIframeSelection();
    }, [selectionPos, clearIframeSelection]);

    const handleHighlightSelection = useCallback((color: HighlightColor) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (!view) return;
      const selection = readIframeSelection(view);
      if (!selection) return;
      // createHighlight stamps the last-used color, so set it before handing off.
      setLastUsedHighlightColor(color);
      paintHighlight(view, selection.cfi, highlightColorHex(color));
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
      const view = viewRef.current as unknown as {
        goToFraction?: (f: number) => Promise<void>;
        resolveNavigation?: (target: unknown) => unknown;
        renderer?: { goTo?: (target: unknown) => Promise<unknown> };
        history?: FoliateHistory;
      } | null;
      if (!view) return;
      const now = Date.now();
      const burst = isSeekBurst(lastSeekAtRef.current, now);
      lastSeekAtRef.current = now;
      try {
        if (burst && view.history && view.renderer?.goTo && view.resolveNavigation) {
          // Still seeking (arrow keys on the progress bar): move the entry
          // the burst pushed instead of stacking one per step.
          await view.renderer.goTo(view.resolveNavigation({ fraction: frac }));
          view.history.replaceState({ fraction: frac });
        } else {
          await view.goToFraction?.(frac);
        }
      } catch (err: unknown) {
        console.error("goToFraction error:", err);
      }
    }, []);
    const goToTocItem = useCallback(async (href: string) => {
      await (viewRef.current as unknown as { goTo?: (h: string) => Promise<void> })
        ?.goTo?.(href)
        .catch((err: unknown) => console.error("goTo error:", err));
    }, []);
    const turnToChapter = useCallback(async (href: string) => {
      const view = viewRef.current as unknown as {
        goTo?: (h: string) => Promise<unknown>;
        resolveNavigation?: (target: string) => unknown;
        renderer?: { goTo?: (target: unknown) => Promise<unknown> };
        history?: FoliateHistory;
      } | null;
      if (!view) return;
      try {
        const resolved = view.resolveNavigation?.(href);
        if (resolved && view.history && view.renderer?.goTo) {
          // Move the current entry along, as a page turn does, instead of
          // pushing one: stepping through chapters is reading, not a jump.
          await view.renderer.goTo(resolved);
          view.history.replaceState(href);
          addReadOnScreens(1);
        } else {
          await view.goTo?.(href);
        }
      } catch (err: unknown) {
        console.error("turnToChapter error:", err);
      }
    }, [addReadOnScreens]);
    const getChapterTicks = useCallback((): number[] => {
      const view = viewRef.current as unknown as {
        getSectionFractions?: () => number[];
        getProgressOf?: (index: number) => { tocItem?: unknown };
      };
      if (!view) return [];
      return chapterTicks(
        view.getSectionFractions?.() ?? [],
        (index) => view.getProgressOf?.(index)?.tocItem,
      );
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
    const goToQuote = useCallback(async (href: string, quote: string) => {
      const view = viewRef.current as unknown as (FoliateAnnotator & {
        book?: { resolveHref?: (href: string) => { index: number } | null };
        search?: (opts: { query: string; index: number }) => AsyncGenerator<unknown>;
      }) | null;
      if (!view) return false;
      clearQuoteFlash();
      try {
        const index = view.book?.resolveHref?.(href)?.index;
        if (index != null && view.search) {
          for (const query of quoteSearchQueries(quote)) {
            for await (const result of view.search({ query, index })) {
              const cfi = (result as { cfi?: unknown } | null)?.cfi;
              if (typeof cfi === "string") {
                // Only the first hit matters; drop foliate's persistent search
                // outline and flash the quote briefly instead.
                view.clearSearch?.();
                const resolved = (await view.goTo?.(cfi)) as
                  | { index: number; anchor?: (doc: Document) => Range }
                  | undefined;
                const contents = view.renderer
                  ?.getContents?.()
                  .find((item) => item.index === resolved?.index);
                const range = contents?.doc ? resolved?.anchor?.(contents.doc) : undefined;
                if (contents?.overlayer && range) {
                  contents.overlayer.add(QUOTE_OVERLAY_KEY, range, Overlayer.highlight, {
                    color: QUOTE_HIGHLIGHT_COLOR,
                  });
                  quoteFlashTimerRef.current = setTimeout(clearQuoteFlash, QUOTE_FLASH_MS);
                }
                return true;
              }
            }
          }
        }
        await view.goTo?.(href);
      } catch (err: unknown) {
        console.error("goToQuote error:", err);
      }
      return false;
    }, [clearQuoteFlash]);
    const setStyles = useCallback((css: string) => {
      const view = viewRef.current as unknown as { renderer?: { setStyles?: (c: string) => void } };
      view?.renderer?.setStyles?.(css);
    }, []);
    const setColumnCount = useCallback((count: number) => {
      const spec = TYPOGRAPHY_RANGES.columnCount;
      const n = clampSnap(count, spec.min, spec.max, spec.step);
      const view = viewRef.current as unknown as {
        renderer?: { setAttribute?: (name: string, value: string) => void };
      };
      view?.renderer?.setAttribute?.("max-column-count", String(n));
    }, []);
    const setFlow = useCallback((flow: ReaderFlow) => {
      scrolledRef.current = flow === "scrolled";
      const view = viewRef.current as unknown as {
        renderer?: { setAttribute?: (name: string, value: string) => void };
      };
      view?.renderer?.setAttribute?.("flow", flow);
    }, []);
    const goBack = useCallback(() => {
      (viewRef.current as unknown as { history?: FoliateHistory } | null)?.history?.back();
    }, []);
    const goForward = useCallback(() => {
      (viewRef.current as unknown as { history?: FoliateHistory } | null)?.history?.forward();
    }, []);
    const searchBook = useCallback((query: string): AsyncIterator<unknown> | null => {
      const view = viewRef.current as unknown as {
        book?: unknown;
        search?: (opts: { query: string }) => AsyncGenerator<unknown>;
      } | null;
      if (!view?.book || !view.search) return null;
      return view.search({ query });
    }, []);
    const clearSearch = useCallback(() => {
      (viewRef.current as unknown as { clearSearch?: () => void } | null)?.clearSearch?.();
    }, []);
    const getToc = useCallback((): TocItem[] => {
      const view = viewRef.current as unknown as { book?: { toc?: TocItem[] } };
      return view?.book?.toc ?? [];
    }, []);
    const getLocation = useCallback(() => lastLocationRef.current, []);
    const getXPointer = useCallback((): string | null => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      const range = view?.lastLocation?.range;
      if (!view || !range) return null;
      const doc = range.startContainer.ownerDocument ?? range.startContainer;
      const index = view.renderer?.getContents?.().find((content) => content.doc === doc)?.index;
      return index == null ? null : xpointerFromRange(range, index);
    }, []);
    const goToXPointer = useCallback(async (xpointer: string, fallbackFraction: number) => {
      const view = viewRef.current as unknown as (FoliateAnnotator & {
        book?: { sections?: { createDocument?: () => Promise<Document> }[] };
      }) | null;
      if (!view) return;
      try {
        const index = parseXPointer(xpointer)?.sectionIndex;
        const section = index == null ? undefined : view.book?.sections?.[index];
        const doc = await section?.createDocument?.();
        const range = doc ? rangeFromXPointer(doc, xpointer) : null;
        const cfi = range && index != null ? view.getCFI?.(index, range) : undefined;
        if (cfi && (await view.goTo?.(cfi)) != null) return;
      } catch (err: unknown) {
        console.error("goToXPointer error:", err);
      }
      await goToFraction(fallbackFraction);
    }, [goToFraction]);
    const getSelectionCfi = useCallback(() => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      return view ? readIframeSelection(view) : null;
    }, []);
    const addHighlight = useCallback((cfi: string) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (!view) return;
      const record = highlightsRef.current.find((item) => item.cfi === cfi);
      paintHighlight(view, cfi, highlightColorHex(record?.color));
    }, []);
    const removeHighlight = useCallback((cfi: string) => {
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      if (view) paintHighlight(view, cfi, undefined, true);
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

    const selectionOpenRef = useRef(false);
    selectionOpenRef.current = selectionPos !== null || editor !== null;
    const dismissSelection = useCallback(() => {
      if (!selectionOpenRef.current) return false;
      closeHighlightEditorRef.current();
      clearIframeSelection();
      return true;
    }, [clearIframeSelection]);
    const hasSelection = useCallback(() => selectionOpenRef.current, []);
    const anchorToSelection = useCallback(() => {
      const selection = lastSelectionDocRef.current?.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(true);
      const view = viewRef.current as unknown as FoliateAnnotator | null;
      // The page doesn't turn: this isn't the reader reading on.
      suppressUserRelocateRef.current += 1;
      const done = () => {
        suppressUserRelocateRef.current = Math.max(0, suppressUserRelocateRef.current - 1);
      };
      void Promise.resolve(view?.renderer?.scrollToAnchor?.(range, false)).then(done, done);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        prev,
        next,
        goToFraction,
        goToTocItem,
        turnToChapter,
        getChapterTicks,
        previewLabelAt,
        goToCfi,
        goToQuote,
        setStyles,
        setColumnCount,
        setFlow,
        goBack,
        goForward,
        searchBook,
        clearSearch,
        getToc,
        getLocation,
        getXPointer,
        goToXPointer,
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
        dismissSelection,
        hasSelection,
        anchorToSelection,
      }),
      [
        prev,
        next,
        goToFraction,
        goToTocItem,
        turnToChapter,
        getChapterTicks,
        previewLabelAt,
        goToCfi,
        goToQuote,
        setStyles,
        setColumnCount,
        setFlow,
        goBack,
        goForward,
        searchBook,
        clearSearch,
        getToc,
        getLocation,
        getXPointer,
        goToXPointer,
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
        dismissSelection,
        hasSelection,
        anchorToSelection,
      ],
    );

    return (
      <div data-testid="reader-view" className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />

        {selectionPos && !editor && (
          <SelectionToolbar
            x={selectionPos.x}
            y={selectionPos.y}
            lastColor={getLastUsedHighlightColor()}
            onHighlight={handleHighlightSelection}
            onCopy={handleCopySelection}
            onAskAgent={handleAskAgent}
          />
        )}

        {editor && (
          <HighlightEditor
            x={editor.x}
            y={editor.y}
            color={editor.color}
            note={editor.note}
            highlightId={editor.id}
            onColorChange={(color) => {
              setEditor((current) => (current ? { ...current, color } : current));
              onUpdateHighlightRef.current?.(editor.id, { color });
            }}
            onNoteCommit={(id, note) => {
              onUpdateHighlightRef.current?.(id, { note: note.trim() ? note : null });
            }}
            onDelete={() => {
              onDeleteHighlightRef.current?.(editor.id);
              closeHighlightEditor();
            }}
          />
        )}

        {image && <ImageViewer image={image} onClose={() => setImage(null)} />}

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
