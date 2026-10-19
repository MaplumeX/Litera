import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { BookImportConfirmDialog } from "@/components/BookImportFeedback";
import { SettingsDialog, type SettingsSection } from "@/components/settings/SettingsDialog";
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
import { cn } from "@/lib/utils";
import { useIncomingBooks } from "@/lib/use-incoming-books";
import { useLibraryShelf, type LibraryShelf } from "@/lib/use-library-shelf";
import { usePlatformLifecycle } from "@/lib/use-platform-lifecycle";
import { useReaderSession, type DownloadDecision } from "@/lib/use-reader-session";
import { useSyncScheduler } from "@/lib/use-sync-scheduler";
import { useSystemInsets } from "@/lib/use-system-insets";
import { MobileLibraryPage } from "@/mobile/MobileLibraryPage";
import { MobileReaderPage, type ReaderPanel } from "@/mobile/MobileReaderPage";
import { MobileTrashPage } from "@/mobile/MobileTrashPage";
import {
  cancelBackPreview,
  commitBackPreview,
  releaseBackPreview,
  startBackPreview,
  updateBackPreview,
  type BackPreviewKind,
} from "@/mobile/back-preview";
import { bookCover, supportsViewTransitions, transitionPage, type PageMotion } from "@/mobile/page-transition";

type Page = "library" | "reader" | "trash";

/**
 * How a page arrives where the WebView has no View Transitions (there the
 * motion lives in page-transition.ts): a Book opens out of the shelf and the
 * shelf comes back from behind it; Trash slides in from the side like a
 * sub-page and back out. Nothing on the first page.
 */
function pageEnterClass(from: Page | null, to: Page): string | undefined {
  if (from === null || from === to) return undefined;
  if (to === "reader") return "m-page-open";
  if (to === "trash") return "m-page-push";
  return from === "reader" ? "m-page-return" : "m-page-pop";
}

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * The topmost open dialog, menu or popup, or null. The footnote popup stays
 * mounted while closed, hidden, so visibility decides.
 */
function topOverlay(): HTMLElement | null {
  const open = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)).filter(
    (element) => getComputedStyle(element).visibility !== "hidden",
  );
  return open[open.length - 1] ?? null;
}

/** How Back's preview moves an overlay, by its kind; null for none (menus, or Back won't close it). */
function overlayPreviewKind(overlay: HTMLElement): BackPreviewKind | null {
  if (overlay.closest("[data-back-preview='none']")) return null;
  if (overlay.classList.contains("m-sheet")) return "sheet";
  if (overlay.classList.contains("m-drawer")) return "drawer";
  if (overlay.classList.contains("m-page-dialog")) return "fullscreen";
  return overlay.matches('[role="dialog"], [role="alertdialog"]') ? "dialog" : null;
}

/**
 * Close the topmost dialog, menu or popup the way Escape would (every
 * overlay here listens for it). False when nothing is open.
 */
function closeTopOverlay(): boolean {
  if (!topOverlay()) return false;
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

/** A snackbar: problems that outlive a page, at the bottom where Android puts them. */
function Banner({ message, onDismiss, alert }: { message: string; onDismiss: () => void; alert?: boolean }) {
  const { t } = useT();
  return (
    <div
      role={alert ? "alert" : "status"}
      className="m-rise pointer-events-auto flex items-center gap-2 rounded-lg bg-foreground py-1.5 pr-1.5 pl-4 text-sm text-background shadow-float"
    >
      <span className="min-w-0 flex-1 py-1.5">{message}</span>
      <Button
        size="sm"
        variant="ghost"
        className="text-background hover:bg-background/10 hover:text-background"
        onClick={onDismiss}
      >
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
  const pageRef = useRef(page);
  pageRef.current = page;
  const pageElementRef = useRef<HTMLDivElement>(null);
  // The page before this one, for the entering animation.
  const [pageTransition, setPageTransition] = useState<{ from: Page | null; to: Page }>({
    from: null,
    to: "library",
  });
  if (pageTransition.to !== page) setPageTransition({ from: pageTransition.to, to: page });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Reading settings' "More settings" opens Settings on the typography page.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
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
    // The Book grows out of the cover that was tapped, when it's on screen.
    onOpened: (context) => {
      const commit = () => {
        setSnap(snapForReaderMode(resolveReaderMode(context.lastReaderMode)));
        setChromeVisible(false);
        setPanel(null);
        setPage("reader");
      };
      if (pageRef.current === "reader") {
        commit();
        return;
      }
      void transitionPage({
        motion: "open",
        commit,
        sharedFrom: () => bookCover(context.bookId),
        sharedTo: () => pageElementRef.current,
      });
    },
    beforeDownload,
  });
  const shelf = useLibraryShelf({ openingBookId: session.openingBookId });
  shelfRef.current = shelf;
  const { refreshBooks, setSearch } = shelf;

  // Closing the search clears it, so the whole shelf comes back.
  const handleSearchOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setSearch("");
      setSearchOpen(open);
    },
    [setSearch],
  );

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

  // A sub-page slides in over the shelf and back out.
  const goToPage = useCallback((next: Page, motion: PageMotion) => {
    void transitionPage({
      motion,
      commit: () => {
        releaseBackPreview();
        setPage(next);
      },
    });
  }, []);

  // The Book shrinks back into its cover. It closes once its last frame is
  // captured, and the shelf reloads first, so the cover it lands on is where
  // "Continue reading" now puts it.
  const closeReader = useCallback(async () => {
    const bookId = session.currentBook?.id;
    await transitionPage({
      motion: "close",
      guard: async () => {
        if (await session.closeBook()) return true;
        cancelBackPreview();
        return false;
      },
      commit: () => {
        releaseBackPreview();
        setPage("library");
        setChromeVisible(false);
        setSnap("collapsed");
        setPanel(null);
      },
      prepare: refreshBooks,
      sharedFrom: () => pageElementRef.current,
      sharedTo: () => (bookId ? bookCover(bookId) : null),
    });
  }, [session.closeBook, session.currentBook?.id, refreshBooks]);

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
  // the Library it closes the search, then leaves the app.
  const handleBack = () => {
    commitBackPreview();
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
      goToPage("library", "pop");
      return;
    }
    if (searchOpen) {
      handleSearchOpenChange(false);
      return;
    }
    void platformBridge.exitApp();
  };
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;
  useEffect(() => platformBridge.listen("back", () => handleBackRef.current()), []);

  // What the predictive Back gesture previews: the same layer Back closes,
  // if it's one that can show it (not the selection, the assistant sheet or
  // the toolbars, and not leaving the app).
  const backPreviewTarget = (): { element: HTMLElement; kind: BackPreviewKind } | null => {
    const overlay = topOverlay();
    if (overlay) {
      const kind = overlayPreviewKind(overlay);
      return kind && { element: overlay, kind };
    }
    const element = pageElementRef.current;
    if (!element) return null;
    if (page === "trash") return { element, kind: "page" };
    if (page !== "reader" || snap !== "collapsed" || chromeVisible) return null;
    if (session.readerRef.current?.hasSelection()) return null;
    return { element, kind: "page" };
  };
  const backPreviewTargetRef = useRef(backPreviewTarget);
  backPreviewTargetRef.current = backPreviewTarget;
  const shellRef = useRef<HTMLElement>(null);
  useEffect(
    () =>
      platformBridge.listen("backProgress", (event) => {
        if (event.phase === "cancel") {
          cancelBackPreview();
          return;
        }
        if (event.phase === "progress") {
          updateBackPreview(event.progress);
          return;
        }
        const target = backPreviewTargetRef.current();
        if (!target) return;
        // A full-screen dialog's backdrop fades to show the page below it.
        const backdrops = document.querySelectorAll<HTMLElement>(".m-page-backdrop");
        const scrim = target.kind === "fullscreen" ? backdrops[backdrops.length - 1] : undefined;
        startBackPreview(target.element, target.kind, event.edge, {
          scrim,
          shell: target.kind === "page" ? shellRef.current : null,
        });
        updateBackPreview(event.progress);
      }),
    [],
  );

  useSystemInsets();

  // Scopes the phone's dialog motion in index.css (dialogs portal to <body>).
  useEffect(() => {
    document.documentElement.classList.add("mobile-ui");
    return () => document.documentElement.classList.remove("mobile-ui");
  }, []);

  // The status and navigation bar icons follow the app's theme, not the
  // system's: dark icons on a light page, light ones on a dark page.
  const lightBars = session.resolvedTheme !== "dark";
  useEffect(() => {
    void platformBridge.setSystemBarsLight(lightBars).catch((error: unknown) => {
      console.error("setSystemBarsLight failed:", error);
    });
  }, [lightBars]);

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
    <main ref={shellRef} className="mobile-shell fixed inset-0 flex flex-col bg-background text-foreground">
      <div
        key={page}
        ref={pageElementRef}
        className={cn(
          "min-h-0 flex-1",
          !supportsViewTransitions() && pageEnterClass(pageTransition.from, page),
        )}
      >
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
            onOpenTypography={() => {
              setSettingsSection("typography");
              setSettingsOpen(true);
            }}
          />
        ) : page === "trash" ? (
          <MobileTrashPage shelf={shelf} onBack={() => goToPage("library", "pop")} />
        ) : (
          <MobileLibraryPage
            shelf={shelf}
            onOpenBook={session.openBook}
            openingBookId={session.openingBookId}
            onOpenSettings={() => {
              setSettingsSection(undefined);
              setSettingsOpen(true);
            }}
            onOpenTrash={() => goToPage("trash", "push")}
            searchOpen={searchOpen}
            onSearchOpenChange={handleSearchOpenChange}
          />
        )}
      </div>
      {(session.persistenceError || syncScheduler.persistentFailure) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-bottom)+5.5rem)] z-40 flex flex-col gap-2 px-4">
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
        </div>
      )}
      <SettingsDialog
        layout="page"
        initialSection={settingsSection}
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
