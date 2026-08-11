import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ReaderView,
  openEpubFile,
  type ReaderViewHandle,
  type SelectionCapture,
} from "@/components/ReaderView";
import { ChatPanel } from "@/components/ChatPanel";

interface FileData {
  bytes: number[];
  name: string;
}

function App() {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [progress, setProgress] = useState<{ index: number; fraction: number; label?: string }>({
    index: 0,
    fraction: 0,
  });
  const [lastCapture, setLastCapture] = useState<SelectionCapture | null>(null);
  const readerRef = useRef<ReaderViewHandle>(null);

  const handleOpenFile = useCallback(async () => {
    const result = await openEpubFile();
    if (result) {
      setFileData({ bytes: result.bytes, name: result.name });
    }
  }, []);

  const handleRelocate = useCallback(
    (index: number, fraction: number, label?: string) => {
      setProgress({ index, fraction, label });
    },
    [],
  );

  const handleSelectionCapture = useCallback((capture: SelectionCapture) => {
    setLastCapture(capture);
    console.log("Selection captured:", capture);
  }, []);

  const fractionPct = Math.round(progress.fraction * 100);
  const chapterLabel = progress.label ?? `Chapter ${progress.index + 1}`;

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      {/* Top toolbar */}
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="text-lg font-bold">Litera</h1>
        <Button size="sm" onClick={handleOpenFile}>
          打开文件
        </Button>
        {fileData && (
          <span className="truncate text-sm text-muted-foreground">{fileData.name}</span>
        )}
      </header>

      {/* Reader + Chat panel split */}
      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          {fileData ? (
            <ReaderView
              ref={readerRef}
              fileData={fileData}
              onRelocate={handleRelocate}
              onSelectionCapture={handleSelectionCapture}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-2">
                <p className="text-muted-foreground">还没有打开的书籍</p>
                <Button onClick={handleOpenFile}>打开 EPUB 文件</Button>
              </div>
            </div>
          )}
        </div>
        {/* Temporary chat panel for sidecar verification */}
        <div className="w-80 shrink-0">
          <ChatPanel />
        </div>
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

      {/* Selection capture debug display */}
      {lastCapture && (
        <div className="fixed bottom-16 right-4 max-w-sm rounded-lg border bg-card p-3 text-xs shadow-lg">
          <p className="font-medium">已捕获选段：</p>
          <p className="mt-1 line-clamp-3 text-muted-foreground">
            &ldquo;{lastCapture.text}&rdquo;
          </p>
          <p className="mt-1 text-muted-foreground">
            章节 #{lastCapture.chapterIndex}
          </p>
        </div>
      )}
    </main>
  );
}

export default App;