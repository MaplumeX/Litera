import { useCallback, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import {
  ReaderView,
  openEpubFile,
  type ReaderViewHandle,
  type SelectionCapture,
} from "@/components/ReaderView";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";

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
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const readerRef = useRef<ReaderViewHandle>(null);
  const chatRef = useRef<ChatPanelHandle>(null);

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
    chatRef.current?.fillInput(capture.text, capture.chapterIndex);
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
        ) : (
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={65} minSize={30}>
              <div className="relative h-full w-full overflow-hidden">
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
            </Panel>
            <Separator className="w-px bg-border hover:bg-primary/30 transition-colors cursor-col-resize" />
            <Panel defaultSize={35} minSize={20}>
              <ChatPanel ref={chatRef} currentChapterIndex={progress.index} />
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