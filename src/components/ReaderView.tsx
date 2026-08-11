import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

// foliate.js view.js defines the <foliate-view> custom element.
// Importing the module registers it with the customElements registry.
import "../foliate-js/view.js";

interface RelocateDetail {
  fraction?: number;
  index?: number;
  tocItem?: { label?: string; fraction?: number };
}

export interface SelectionCapture {
  text: string;
  chapterIndex: number;
}

export interface ReaderViewHandle {
  prev: () => void;
  next: () => void;
}

interface ReaderViewProps {
  /** Bytes of an opened EPUB file, or null when no file is loaded. */
  fileData: { bytes: number[]; name: string } | null;
  /** Called when the reader relocates (page turn / scroll). */
  onRelocate?: (index: number, fraction: number, label?: string) => void;
  /** Called when the user clicks the "问 agent" button on a selection. */
  onSelectionCapture?: (capture: SelectionCapture) => void;
  /** Last reading fraction to restore (0-1), from library persistence. */
  initialFraction?: number;
}

export const ReaderView = forwardRef<ReaderViewHandle, ReaderViewProps>(
  function ReaderView({ fileData, onRelocate, onSelectionCapture, initialFraction }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<HTMLElement | null>(null);
    const currentChapterRef = useRef(0);
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
        onRelocate?.(index, fraction, label);
      };
      el.addEventListener("relocate", handleRelocate as EventListener);

      return () => {
        el.removeEventListener("relocate", handleRelocate as EventListener);
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
      const file = new File([new Uint8Array(bytes)], name);
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
        })
        .catch((err: unknown) => console.error("foliate open error:", err));
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

    useImperativeHandle(ref, () => ({ prev, next }), [prev, next]);

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

/** Helper to open a file via the Rust open_file command. */
export async function openEpubFile(): Promise<{
  bytes: number[];
  name: string;
  path: string;
  bookId: string;
} | null> {
  try {
    const result = await invoke<{ path: string; name: string; bytes: number[]; bookId: string }>(
      "open_file",
    );
    return result;
  } catch (err) {
    console.error("open_file error:", err);
    return null;
  }
}