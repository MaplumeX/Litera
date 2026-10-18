import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { BookImportConfirmDialog } from "@/components/BookImportFeedback";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import {
  readerModeForSnap,
  snapForReaderMode,
  type SheetSnap,
} from "@/lib/assistant-sheet";
import { useT } from "@/lib/i18n";
import { loadMobileSettings, useMobileSettings, type MobileSettings } from "@/lib/mobile-settings";
import { platformBridge } from "@/lib/platform-bridge";
import { resolveReaderMode } from "@/lib/reader-mode";
import { volumeKeyAction } from "@/lib/reader-paging";
import { formatByteSize } from "@/lib/trash";
import { useIncomingBooks } from "@/lib/use-incoming-books";
import { useLibraryShelf, type LibraryShelf } from "@/lib/use-library-shelf";
import { usePlatformLifecycle } from "@/lib/use-platform-lifecycle";
import { useReaderSession, type DownloadDecision } from "@/lib/use-reader-session";
import { useSyncScheduler } from "@/lib/use-sync-scheduler";
import { MobileLibraryPage } from "@/mobile/MobileLibraryPage";
import { MobileReaderPage, type ReaderPanel } from "@/mobile/MobileReaderPage";
import { MobileTrashPage } from "@/mobile/MobileTrashPage";

type Page = "library" | "reader" | "trash";

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Close the topmost dialog, menu or popup the way Escape would (every
 * overlay here listens for it). False when nothing is open. The footnote
 * popup stays mounted while closed, hidden, so visibility decides.
 */
function closeTopOverlay(): boolean {
  const open = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)).some(
    (element) => getComputedStyle(element).visibility !== "hidden",
  );
  if (!open) return false;
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
  );
  return true;
}

/** The Wi-Fi-only rule: book files move only when allowed on this network. */
async function bookFilesAllowed(settings: MobileSettings = loadMobileSettings()): Promise<boolean> {
  if (!settings.wifiOnlyBookFiles) return true;
  return !(await platformBridge.isNetworkMetered());
}

function Banner({ message, onDismiss, alert }: { message: string; onDismiss: () => void; alert?: boolean }) {
  const { t } = useT();
  return (
    <div
      role={alert ? "alert" : "status"}
      className={
        alert
          ? "flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          : "flex items-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
      }
    >
      <span className="min-w-0 flex-1">{message}</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t("common.close")}
      </Button>
    </div>
  );
}

function DeviceSettings({
  settings,
  onChange,
}: {
  settings: MobileSettings;
  onChange: (patch: Partial<MobileSettings>) => void;
}) {
  const { t } = useT();
  const rows: { key: keyof MobileSettings; label: string; hint?: string }[] = [
    { key: "volumeKeyPaging", label: t("mobile.volumeKeys") },
    { key: "keepScreenOn", label: t("mobile.keepScreenOn") },
    { key: "wifiOnlyBookFiles", label: t("mobile.wifiOnly"), hint: t("mobile.wifiOnlyHint") },
  ];
  return (
    <>
      {rows.map((row) => (
        <label key={row.key} className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm">{row.label}</span>
            {row.hint && <span className="mt-1 block text-xs text-muted-foreground">{row.hint}</span>}
          </span>
          <input
            type="checkbox"
            role="switch"
            className="mt-0.5 size-5 shrink-0 accent-primary"
            checked={settings[row.key]}
            onChange={(event) => onChange({ [row.key]: event.target.checked })}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">{t("mobile.uninstallNote")}</p>
    </>
  );
}

/**
 * The phone's shell: a page stack (Library → Reader, plus Trash), overlays
 * above it, and the platform bridge for Back, volume keys, the app
 * lifecycle, incoming books and the window. The open Book, the shelf and
 * Sync are the same modules the desktop shell uses.
 */
export default function MobileApp() {
  const { t, locale } = useT();
  const [mobileSettings, updateMobileSettings] = useMobileSettings();
  const [page, setPage] = useState<Page>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>("collapsed");
  const [panel, setPanel] = useState<ReaderPanel | null>(null);
  const shelfRef = useRef<LibraryShelf | null>(null);

  const syncScheduler = useSyncScheduler({ transferBookFiles: () => bookFilesAllowed() });

  // On mobile data with Wi-Fi only on: a Book that isn't on the phone says
  // how big it is and lets the reader decide; a newer file for a Book that
  // is waits for Wi-Fi.
  const beforeDownload = useCallback(
    async (bookId: string): Promise<DownloadDecision> => {
      if (await bookFilesAllowed()) return "download";
      const size = await invoke<number | null>("sync_book_download_size", { bookId }).catch(
        () => null,
      );
      const shelf = shelfRef.current;
      if (size == null || !shelf) return "download";
      const book = shelf.books.find((item) => item.id === bookId);
      if (book && book.cached !== false) return "skip";
      const confirmed = await shelf.askConfirm({
        title: t("mobile.downloadTitle", { title: book?.title ?? "" }),
        description: t("mobile.downloadDesc", { size: formatByteSize(size, locale) }),
        confirmLabel: t("mobile.download"),
      });
      return confirmed ? "download" : "cancel";
    },
    [locale, t],
  );

  const session = useReaderSession({
    onOpened: (context) => {
      setSnap(snapForReaderMode(resolveReaderMode(context.lastReaderMode)));
      setChromeVisible(false);
      setPanel(null);
      setPage("reader");
    },
    beforeDownload,
  });
  const shelf = useLibraryShelf({ openingBookId: session.openingBookId });
  shelfRef.current = shelf;
  const { refreshBooks } = shelf;

  // The shelf stays mounted while reading; coming back shows fresh progress
  // and "recently opened" order.
  useEffect(() => {
    if (page === "library") void refreshBooks();
  }, [page, refreshBooks]);

  const snapRef = useRef(snap);
  snapRef.current = snap;
  const handleSnapChange = useCallback(
    (next: SheetSnap) => {
      if (readerModeForSnap(next) !== readerModeForSnap(snapRef.current)) {
        session.rememberReaderMode(readerModeForSnap(next));
      }
      snapRef.current = next;
      setSnap(next);
    },
    [session.rememberReaderMode],
  );

  const closeReader = useCallback(async () => {
    if (!(await session.closeBook())) return;
    setPage("library");
    setChromeVisible(false);
    setSnap("collapsed");
    setPanel(null);
  }, [session.closeBook]);

  useIncomingBooks({
    importIncoming: (books) => shelf.importIncoming(books, { suppressDuplicateNotice: true }),
    openBook: session.openBook,
  });

  usePlatformLifecycle({
    flush: session.flushReadingState,
    flushKosync: session.kosync.flush,
    syncNow: syncScheduler.syncNow,
  });

  const handleCloseSettings = useCallback(async () => {
    try {
      await session.flushReadingState();
    } catch {
      return;
    }
    setSettingsOpen(false);
  }, [session.flushReadingState]);

  // Back closes the innermost layer: a dialog or the selection, then the
  // assistant sheet, then the reader toolbars, then the Reader itself. On
  // the Library it leaves the app.
  const handleBack = () => {
    if (closeTopOverlay()) return;
    if (page === "reader") {
      if (session.readerRef.current?.dismissSelection()) return;
      if (snap !== "collapsed") {
        handleSnapChange("collapsed");
        return;
      }
      if (chromeVisible) {
        setChromeVisible(false);
        return;
      }
      void closeReader();
      return;
    }
    if (page === "trash") {
      setPage("library");
      return;
    }
    void platformBridge.exitApp();
  };
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;
  useEffect(() => platformBridge.listen("back", () => handleBackRef.current()), []);

  // Chrome-free reading is immersive: no status or navigation bar.
  const immersive = page === "reader" && !chromeVisible;
  useEffect(() => {
    void platformBridge.setImmersive(immersive).catch((error: unknown) => {
      console.error("setImmersive failed:", error);
    });
  }, [immersive]);

  const keepScreenOn = page === "reader" && mobileSettings.keepScreenOn;
  useEffect(() => {
    void platformBridge.setKeepScreenOn(keepScreenOn).catch((error: unknown) => {
      console.error("setKeepScreenOn failed:", error);
    });
  }, [keepScreenOn]);

  // Volume keys page only while the Book is what's on screen; elsewhere the
  // system keeps them for the volume.
  const readerActive = page === "reader" && snap !== "full";
  const volumePaging = readerActive && mobileSettings.volumeKeyPaging;
  useEffect(() => {
    void platformBridge.setVolumeKeyPaging(volumePaging).catch((error: unknown) => {
      console.error("setVolumeKeyPaging failed:", error);
    });
  }, [volumePaging]);
  const volumeContextRef = useRef({ enabled: mobileSettings.volumeKeyPaging, readerActive });
  volumeContextRef.current = { enabled: mobileSettings.volumeKeyPaging, readerActive };
  const readerRef = session.readerRef;
  useEffect(
    () =>
      platformBridge.listen("volumeKey", ({ direction }) => {
        const action = volumeKeyAction(direction, volumeContextRef.current);
        if (action === "next") readerRef.current?.next();
        else if (action === "prev") readerRef.current?.prev();
      }),
    [readerRef],
  );

  const editingBook = page === "reader" && session.editingBook;

  return (
    <main className="mobile-shell fixed inset-0 flex flex-col bg-background text-foreground">
      {session.persistenceError && (
        <Banner
          alert
          message={t("reader.persistFailed", { message: session.persistenceError })}
          onDismiss={session.clearPersistenceError}
        />
      )}
      {syncScheduler.persistentFailure && (
        <Banner
          message={t("sync.failureNotice", { message: syncScheduler.persistentFailure })}
          onDismiss={syncScheduler.clearPersistentFailure}
        />
      )}
      <div className="min-h-0 flex-1">
        {page === "reader" ? (
          <MobileReaderPage
            session={session}
            chromeVisible={chromeVisible}
            onToggleChrome={() => setChromeVisible((visible) => !visible)}
            snap={snap}
            onSnapChange={handleSnapChange}
            panel={panel}
            onPanelChange={setPanel}
            onBack={() => void closeReader()}
            onOpenTypography={() => setSettingsOpen(true)}
          />
        ) : page === "trash" ? (
          <MobileTrashPage shelf={shelf} onBack={() => setPage("library")} />
        ) : (
          <MobileLibraryPage
            shelf={shelf}
            onOpenBook={session.openBook}
            openingBookId={session.openingBookId}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenTrash={() => setPage("trash")}
          />
        )}
      </div>
      <SettingsDialog
        layout="page"
        open={settingsOpen}
        onClose={() => void handleCloseSettings()}
        bookTitle={editingBook ? session.bookTitle || null : null}
        hasBook={editingBook}
        styleState={session.styleState}
        onTypographyChange={session.handleTypographyChange}
        onRestoreDefault={session.handleRestoreDefault}
        overriddenKeys={editingBook ? session.overriddenKeys : []}
        theme={session.globalTheme}
        onThemeChange={session.setGlobalTheme}
        onReaderFlowChange={session.setReaderFlow}
        deviceSettings={<DeviceSettings settings={mobileSettings} onChange={updateMobileSettings} />}
      />
      <BookImportConfirmDialog
        confirmOpen={shelf.confirmOpen}
        confirmRequest={shelf.confirmRequest}
        settleConfirm={shelf.settleConfirm}
      />
    </main>
  );
}
