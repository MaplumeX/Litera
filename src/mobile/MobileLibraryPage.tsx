import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Menu, Plus, X } from "lucide-react";
import type { BookRecord } from "@/types/library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookCard, BookListRow, BookResumeTile } from "@/components/BookCard";
import { BookDetailsDialog } from "@/components/BookDetailsDialog";
import { LibraryShelfToolbar } from "@/components/LibraryShelfToolbar";
import { LibrarySidebar } from "@/components/LibrarySidebar";
import { BookImportNotices } from "@/components/BookImportFeedback";
import {
  BookActionSheetItems,
  BookActionSheetProvider,
  type BookActionHandlers,
} from "@/components/BookActionsMenu";
import type { LibraryShelf } from "@/lib/use-library-shelf";
import { useT } from "@/lib/i18n";
import { MobileSheet } from "@/mobile/MobileSheet";

interface MobileLibraryPageProps {
  shelf: LibraryShelf;
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId: string | null;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
}

/**
 * The phone's Library: search, sort and layout on top, Continue reading,
 * then the shelf. Filters, Trash and Settings sit in a left drawer; a
 * long-press on a book opens its actions as a bottom sheet.
 */
export function MobileLibraryPage({
  shelf,
  onOpenBook,
  openingBookId,
  onOpenSettings,
  onOpenTrash,
}: MobileLibraryPageProps) {
  const { t } = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actions, setActions] = useState<BookActionHandlers | null>(null);
  const {
    books,
    loaded,
    loadError,
    search,
    setSearch,
    searching,
    view,
    visible,
    recents,
    cacheColumn,
    statusFilter,
    statusFilterOption,
    coverRev,
    importing,
    busy,
  } = shelf;

  const bookProps = {
    onOpen: onOpenBook,
    onDelete: shelf.handleDelete,
    onDetails: shelf.setDetailsBook,
    onToggleStar: (target: BookRecord) => void shelf.handleToggleStar(target),
    onChangeStatus: (target: BookRecord, status: Parameters<typeof shelf.handleChangeStatus>[1]) =>
      void shelf.handleChangeStatus(target, status),
    deleteDisabled: busy,
    selectMode: false,
    onToggleSelect: shelf.handleToggleSelect,
    openDisabled: importing,
    statusFilter,
  };

  const handleImport = () => {
    setDrawerOpen(false);
    void shelf.handleImport();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-2 px-3 pt-[calc(var(--android-inset-top,0px)+0.5rem)] pb-2">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("mobile.menu")}
            aria-expanded={drawerOpen}
          >
            <Menu />
          </Button>
          <h1 className="min-w-0 flex-1 select-none text-base font-medium">Litera</h1>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleImport}
            disabled={busy}
            aria-label={t("library.importBooks")}
          >
            <Plus />
          </Button>
        </div>
        <div className="relative">
          <Input
            type="search"
            placeholder={t("library.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 w-full pr-10"
          />
          {search && (
            <button
              type="button"
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground"
              aria-label={t("library.clearSearch")}
              onClick={() => setSearch("")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </header>

      {books.length > 0 && (
        <LibraryShelfToolbar
          statusFilter={statusFilter}
          count={visible.length}
          searching={searching}
          sort={shelf.sort}
          onSortChange={shelf.handleSortChange}
          order={shelf.order}
          onOrderChange={shelf.handleOrderChange}
          view={view}
          onViewChange={shelf.handleViewChange}
        />
      )}

      {loadError && (
        <div role="alert" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {t("library.loadFailed", { message: loadError })}
        </div>
      )}

      <BookImportNotices
        notices={shelf.notices}
        dismissNotice={shelf.dismissNotice}
        onOpenBook={onOpenBook}
        actionDisabled={importing}
      />

      <BookActionSheetProvider value={setActions}>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--android-inset-bottom,0px)+1rem)] pt-2">
          {!loaded || (books.length === 0 && loadError) ? null : books.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="space-y-3 text-center">
                <p className="text-muted-foreground">{t("library.empty")}</p>
                <Button onClick={handleImport} disabled={busy}>
                  <Plus className="size-4" />
                  <span>{importing ? t("library.importing") : t("library.importEpub")}</span>
                </Button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="space-y-3 text-center">
                <p className="text-muted-foreground">
                  {statusFilterOption && statusFilter !== "all"
                    ? t("library.noMatchesInFilter", { filter: t(statusFilterOption.labelKey) })
                    : t("library.noMatches")}
                </p>
                <Button size="sm" variant="outline" onClick={shelf.handleClearFilters}>
                  {t("library.clearFilters")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {recents.length > 0 && (
                <section>
                  <h2 className="mb-1 text-sm font-medium">{t("library.continueReading")}</h2>
                  <div data-shelf="recent" className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 pt-1">
                    {recents.map((book) => (
                      <BookResumeTile
                        key={`recent-${book.id}`}
                        book={book}
                        opening={openingBookId === book.id}
                        coverRev={coverRev[book.id]}
                        {...bookProps}
                      />
                    ))}
                  </div>
                </section>
              )}
              {view === "list" ? (
                <div data-shelf="main" className="flex flex-col gap-2">
                  {visible.map((book) => (
                    <BookListRow
                      key={book.id}
                      book={book}
                      opening={openingBookId === book.id}
                      selected={false}
                      coverRev={coverRev[book.id]}
                      cacheColumn={cacheColumn}
                      {...bookProps}
                    />
                  ))}
                </div>
              ) : (
                <div data-shelf="main" className="grid grid-cols-3 gap-x-3 gap-y-5">
                  {visible.map((book) => (
                    <BookCard
                      key={book.id}
                      book={book}
                      opening={openingBookId === book.id}
                      selected={false}
                      coverRev={coverRev[book.id]}
                      {...bookProps}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </BookActionSheetProvider>

      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex outline-none"
          >
            <DialogPrimitive.Title className="sr-only">{t("mobile.drawer")}</DialogPrimitive.Title>
            <LibrarySidebar
              statusFilter={statusFilter}
              counts={shelf.statusCounts}
              onStatusFilterChange={(value) => {
                shelf.handleStatusFilterChange(value);
                setDrawerOpen(false);
              }}
              onImport={handleImport}
              importing={importing}
              trashCount={shelf.trashEntries.length}
              onOpenTrash={() => {
                setDrawerOpen(false);
                onOpenTrash();
              }}
              onOpenSettings={() => {
                setDrawerOpen(false);
                onOpenSettings();
              }}
              busy={busy}
              className="w-64 pt-[var(--android-inset-top,0px)] pb-[var(--android-inset-bottom,0px)] shadow-float"
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <MobileSheet
        open={actions !== null}
        onOpenChange={(open) => {
          if (!open) setActions(null);
        }}
        title={t("mobile.bookActions", { title: actions?.title ?? "" })}
      >
        {actions && (
          <div
            className="pb-2"
            onClick={(event) => {
              // Picking a row closes the sheet; the row's own handler runs too.
              if ((event.target as Element).closest("button:not(:disabled)")) setActions(null);
            }}
          >
            <BookActionSheetItems {...actions} />
          </div>
        )}
      </MobileSheet>

      <BookDetailsDialog
        book={shelf.detailsBook}
        coverRev={shelf.detailsBook ? coverRev[shelf.detailsBook.id] : undefined}
        open={shelf.detailsBook !== null}
        onOpenChange={(open) => {
          if (!open) shelf.setDetailsBook(null);
        }}
        onSaved={shelf.handleDetailsSaved}
      />
    </div>
  );
}
