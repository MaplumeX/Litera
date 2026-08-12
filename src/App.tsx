import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import {
  ReaderView,
  type ReaderViewHandle,
  type SelectionCapture,
  type TocItem,
} from "@/components/ReaderView";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { LibraryView } from "@/components/LibraryView";
import { TocSidebar } from "@/components/TocSidebar";
import { ReaderControls } from "@/components/ReaderControls";
import {
  generateStylesCss,
  normalizeSettings,
  type ReaderStyleState,
} from "@/lib/reader-styles";
import type { BookRecord, OpenBookResult } from "@/types/library";

interface FileData {
  bytes: number[];
  name: string;
  bookId: string;
}

// Debounce helper for persisting reading state.
function useDebouncedCallback<T extends (...args: never[]) => void>(
  fn: T,
  delay: number,
): T {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback(
    (...args: Parameters<T>) => {
      if (ref.current) clearTimeout(ref.current);
      ref.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  ) as T;
}

function App() {
  const [view, setView] = useState<"library" | "reader">("library");
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [currentBook, setCurrentBook] = useState<BookRecord | null>(null);
  const [progress, setProgress] = useState<{ index: number; fraction: number; label?: string }>({
    index: 0,
    fraction: 0,
  });
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [styleState, setStyleState] = useState<ReaderStyleState>({
    fontSize: 16,
    fontFamily: "serif",
    theme: "light",
  });
  const readerRef = useRef<ReaderViewHandle>(null);
  const chatRef = useRef<ChatPanelHandle>(null);
  // Track latest style state so handleBookReady can apply it after renderer mounts.
  const styleStateRef = useRef(styleState);
  styleStateRef.current = styleState;

  // Persist reading position (debounced).
  const persistFraction = useDebouncedCallback((bookId: string, fraction: number) => {
    void invoke("update_reading_state", { bookId, lastFraction: fraction }).catch(() => {});
  }, 500);

  // Persist reading settings (debounced).
  const persistSettings = useDebouncedCallback(
    (bookId: string, state: ReaderStyleState) => {
      void invoke("update_reading_state", {
        bookId,
        settings: {
          fontSize: state.fontSize,
          fontFamily: state.fontFamily,
          theme: state.theme,
        },
      }).catch(() => {});
    },
    500,
  );

  // Apply styles + persist whenever style state changes.
  useEffect(() => {
    const css = generateStylesCss(styleState);
    readerRef.current?.setStyles(css);
  }, [styleState]);

  const handleOpenBook = useCallback(async (bookId: string) => {
    try {
      const result = await invoke<OpenBookResult>("open_book", { bookId });
      setFileData({
        bytes: result.bytes,
        name: result.name,
        bookId: result.bookId,
      });

      // Build a partial BookRecord for passing lastFraction + settings to ReaderView.
      // The full record is fetched from list_books; we use the open_book result fields.
      setCurrentBook({
        id: result.bookId,
        title: "",
        author: "",
        coverPath: "",
        filePath: "",
        importedAt: "",
        lastFraction: result.lastFraction,
        settings: result.settings,
      });

      // Initialize style state from saved settings.
      setStyleState(normalizeSettings(result.settings));

      setView("reader");
    } catch (err) {
      console.error("open_book error:", err);
      alert(`打开书籍失败: ${err}`);
    }
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setView("library");
    setFileData(null);
    setCurrentBook(null);
    setToc([]);
    setTocVisible(false);
    setControlsOpen(false);
  }, []);

  const handleRelocate = useCallback(
    (index: number, fraction: number, label?: string) => {
      setProgress({ index, fraction, label });
      // Persist reading position.
      if (fileData?.bookId) {
        persistFraction(fileData.bookId, fraction);
      }
    },
    [fileData?.bookId, persistFraction],
  );

  const handleSelectionCapture = useCallback((capture: SelectionCapture) => {
    chatRef.current?.fillInput(capture.text, capture.chapterIndex);
  }, []);

  const handleBookReady = useCallback((bookToc: TocItem[]) => {
    setToc(bookToc);
    // Apply saved styles now that the renderer exists.
    readerRef.current?.setStyles(generateStylesCss(styleStateRef.current));
  }, []);

  const handleStyleChange = useCallback(
    (state: ReaderStyleState) => {
      setStyleState(state);
      if (fileData?.bookId) {
        persistSettings(fileData.bookId, state);
      }
    },
    [fileData?.bookId, persistSettings],
  );

  const handleTocGoTo = useCallback((href: string) => {
    readerRef.current?.goToTocItem(href);
  }, []);

  const fractionPct = Math.round(progress.fraction * 100);
  const chapterLabel = progress.label ?? `Chapter ${progress.index + 1}`;
  const bookTitle = currentBook?.title || fileData?.name || "";

  if (view === "library") {
    return (
      <main className="h-screen bg-background text-foreground">
        <LibraryView onOpenBook={handleOpenBook} />
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      {/* Top toolbar */}
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button size="sm" variant="outline" onClick={handleBackToLibrary}>
          ← 书库
        </Button>
        <h1 className="text-lg font-bold">Litera</h1>
        {bookTitle && (
          <span className="truncate text-sm text-muted-foreground">{bookTitle}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* TOC toggle */}
          <Button
            size="sm"
            variant={tocVisible ? "default" : "outline"}
            onClick={() => setTocVisible((v) => !v)}
          >
            ☰ 目录
          </Button>
          {/* Font + theme controls (dropdown panel) */}
          <div className="relative">
            <Button
              size="sm"
              variant={controlsOpen ? "default" : "outline"}
              onClick={() => setControlsOpen((v) => !v)}
            >
              Aa
            </Button>
            <ReaderControls
              open={controlsOpen}
              state={styleState}
              onChange={(s) => {
                handleStyleChange(s);
              }}
            />
          </div>
          {/* Chat toggle */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setChatCollapsed((v) => !v)}
          >
            {chatCollapsed ? "显示对话" : "隐藏对话"}
          </Button>
        </div>
      </header>

      {/* Reader + Chat panel split */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* TOC sidebar */}
        {tocVisible && (
          <div className="h-full w-56 shrink-0 overflow-y-auto border-r">
            <TocSidebar toc={toc} onGoTo={handleTocGoTo} />
          </div>
        )}

        {chatCollapsed ? (
          <div className="relative h-full w-full overflow-hidden">
            {fileData && (
              <ReaderView
                ref={readerRef}
                fileData={fileData}
                onRelocate={handleRelocate}
                onSelectionCapture={handleSelectionCapture}
                initialFraction={currentBook?.lastFraction}
                onBookReady={handleBookReady}
              />
            )}
          </div>
        ) : (
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={65} minSize={30}>
              <div className="relative h-full w-full overflow-hidden">
                {fileData && (
                  <ReaderView
                    ref={readerRef}
                    fileData={fileData}
                    onRelocate={handleRelocate}
                    onSelectionCapture={handleSelectionCapture}
                    initialFraction={currentBook?.lastFraction}
                    onBookReady={handleBookReady}
                  />
                )}
              </div>
            </Panel>
            <Separator className="w-px bg-border hover:bg-primary/30 transition-colors cursor-col-resize" />
            <Panel defaultSize={35} minSize={20}>
              <ChatPanel ref={chatRef} currentChapterIndex={progress.index} bookId={fileData?.bookId ?? ""} />
            </Panel>
          </Group>
        )}
      </div>

      {/* Bottom navigation bar */}
      {fileData && (
        <footer className="flex items-center justify-between border-t px-4 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => readerRef.current?.prev()}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {chapterLabel} · {fractionPct}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => readerRef.current?.next()}
          >
            下一页
          </Button>
        </footer>
      )}
    </main>
  );
}

export default App;