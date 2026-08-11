import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import {
  ReaderView,
  type ReaderViewHandle,
  type SelectionCapture,
} from "@/components/ReaderView";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { LibraryView } from "@/components/LibraryView";
import type { BookRecord, OpenBookResult } from "@/types/library";

interface FileData {
  bytes: number[];
  name: string;
  bookId: string;
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
  const readerRef = useRef<ReaderViewHandle>(null);
  const chatRef = useRef<ChatPanelHandle>(null);

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
  }, []);

  const handleRelocate = useCallback(
    (index: number, fraction: number, label?: string) => {
      setProgress({ index, fraction, label });
      // Persist reading position.
      if (fileData?.bookId) {
        void invoke("update_reading_state", {
          bookId: fileData.bookId,
          lastFraction: fraction,
        }).catch(() => {});
      }
    },
    [fileData?.bookId],
  );

  const handleSelectionCapture = useCallback((capture: SelectionCapture) => {
    chatRef.current?.fillInput(capture.text, capture.chapterIndex);
  }, []);

  const fractionPct = Math.round(progress.fraction * 100);
  const chapterLabel = progress.label ?? `Chapter ${progress.index + 1}`;

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
        {fileData && (
          <span className="truncate text-sm text-muted-foreground">{fileData.name}</span>
        )}
        <div className="ml-auto">
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
        {chatCollapsed ? (
          <div className="relative h-full w-full overflow-hidden">
            {fileData && (
              <ReaderView
                ref={readerRef}
                fileData={fileData}
                onRelocate={handleRelocate}
                onSelectionCapture={handleSelectionCapture}
                initialFraction={currentBook?.lastFraction}
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