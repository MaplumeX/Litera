import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ArrowLeft,
  Check,
  Menu,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookActions } from "@/components/BookCard";
import { BookDetailsDialog } from "@/components/BookDetailsDialog";
import { SORT_OPTIONS, STATUS_OPTIONS } from "@/components/LibraryShelfToolbar";
import { BookImportNotices } from "@/components/BookImportFeedback";
import {
  BookActionSheetItems,
  BookActionSheetProvider,
  type BookActionHandlers,
} from "@/components/BookActionsMenu";
import type { BookRecord } from "@/types/library";
import type { LibraryShelf } from "@/lib/use-library-shelf";
import type { LibrarySortOrder } from "@/lib/library-shelf";
import type { LibraryViewMode } from "@/lib/library-shelf-prefs";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppBarIconButton, MobileAppBar } from "@/mobile/MobileAppBar";
import { MobileBookRow, MobileBookTile, MobileResumeCard } from "@/mobile/MobileBookItems";
import { MobileSheet } from "@/mobile/MobileSheet";
import { useSwipeDismiss } from "@/mobile/swipe-dismiss";

interface MobileLibraryPageProps {
  shelf: LibraryShelf;
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId: string | null;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  /** The app bar is the search field (the shell owns it, so Back can close it). */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}

/** A row in a bottom sheet or the drawer: icon, label, an optional trailing part. */
function SheetRow({
  icon: Icon,
  label,
  trailing,
  selected,
  onClick,
  disabled,
  ...aria
}: {
  icon?: LucideIcon;
  label: string;
  trailing?: ReactNode;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-checked"?: boolean;
  role?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-12 w-full items-center gap-4 px-6 text-left text-[0.9375rem] transition-colors active:bg-foreground/5 disabled:opacity-50",
        selected && "font-medium",
      )}
      {...aria}
    >
      {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

const ORDER_OPTIONS: { value: LibrarySortOrder; labelKey: MessageKey }[] = [
  { value: "asc", labelKey: "library.sortAscending" },
  { value: "desc", labelKey: "library.sortDescending" },
];

const VIEW_OPTIONS: { value: LibraryViewMode; labelKey: MessageKey }[] = [
  { value: "grid", labelKey: "library.viewGrid" },
  { value: "list", labelKey: "library.viewList" },
];

/** A titled group of choices in a bottom sheet, the picked one ticked. */
function SheetRadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; labelKey: MessageKey }[];
  onChange: (value: T) => void;
}) {
  const { t } = useT();
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="px-6 pt-3 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {options.map((option) => (
        <SheetRow
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          label={t(option.labelKey)}
          selected={value === option.value}
          trailing={value === option.value && <Check className="size-5 text-primary" aria-hidden />}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

/**
 * The phone's Library, laid out like other Android readers: a top app bar
 * (menu, search, sort), filter chips, the Books you're reading as cards,
 * then the shelf; a floating button imports. The drawer holds Trash and
 * Settings; a long-press on a Book opens its actions as a bottom sheet.
 */
export function MobileLibraryPage({
  shelf,
  onOpenBook,
  openingBookId,
  onOpenSettings,
  onOpenTrash,
  searchOpen,
  onSearchOpenChange,
}: MobileLibraryPageProps) {
  const { t } = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [actions, setActions] = useState<BookActionHandlers | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // The drawer closes with a swipe left as well as a tap on the scrim.
  const drawerScrimRef = useRef<HTMLDivElement>(null);
  const drawerSwipeRef = useSwipeDismiss<HTMLDivElement>({
    direction: "left",
    onDismiss: () => setDrawerOpen(false),
    scrimRef: drawerScrimRef,
  });
  const {
    books,
    loaded,
    loadError,
    search,
    setSearch,
    view,
    visible,
    recents,
    statusFilter,
    statusFilterOption,
    coverRev,
    importing,
    busy,
  } = shelf;

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const actionsFor = (book: BookRecord) =>
    bookActions(book, {
      onOpen: onOpenBook,
      onDetails: shelf.setDetailsBook,
      onDelete: shelf.handleDelete,
      deleteDisabled: busy,
      onToggleStar: (target) => void shelf.handleToggleStar(target),
      onChangeStatus: (target, status) => void shelf.handleChangeStatus(target, status),
    });

  const itemProps = (book: BookRecord) => ({
    book,
    actions: actionsFor(book),
    opening: openingBookId === book.id,
    disabled: importing,
    coverRev: coverRev[book.id],
  });

  const handleImport = () => {
    setDrawerOpen(false);
    void shelf.handleImport();
  };

  const closeSearch = () => onSearchOpenChange(false);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {searchOpen ? (
        <MobileAppBar className="m-enter-fade">
          <AppBarIconButton label={t("mobile.closeSearch")} onClick={closeSearch}>
            <ArrowLeft />
          </AppBarIconButton>
          <input
            ref={searchRef}
            type="search"
            enterKeyHint="search"
            placeholder={t("library.searchPlaceholder")}
            aria-label={t("mobile.searchLibrary")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <AppBarIconButton label={t("library.clearSearch")} onClick={() => setSearch("")}>
              <X />
            </AppBarIconButton>
          )}
        </MobileAppBar>
      ) : (
        <MobileAppBar
          navigation={
            <AppBarIconButton
              label={t("mobile.menu")}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu />
            </AppBarIconButton>
          }
          title={t("mobile.shelf")}
          actions={
            <>
              <AppBarIconButton label={t("mobile.searchLibrary")} onClick={() => onSearchOpenChange(true)}>
                <Search />
              </AppBarIconButton>
              {books.length > 0 && (
                <AppBarIconButton label={t("mobile.sortAndView")} onClick={() => setSortOpen(true)}>
                  <SlidersHorizontal />
                </AppBarIconButton>
              )}
            </>
          }
        />
      )}

      {books.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t("library.statusFilter")}
          className="flex shrink-0 gap-2 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none]"
        >
          {STATUS_OPTIONS.map((option) => {
            const active = option.value === statusFilter;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => shelf.handleStatusFilterChange(option.value)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors motion-reduce:transition-none",
                  active
                    ? "border-transparent bg-secondary font-medium text-secondary-foreground"
                    : "border-border text-foreground/80 active:bg-foreground/5",
                )}
              >
                {active && <Check className="size-4" aria-hidden />}
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
      )}

      {loadError && (
        <div role="alert" className="mx-4 mb-2 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
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
        {/* Bottom padding clears the floating import button. */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(var(--safe-bottom)+6rem)]">
          {!loaded || (books.length === 0 && loadError) ? null : books.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <p className="text-muted-foreground">{t("library.empty")}</p>
              <Button onClick={handleImport} disabled={busy} className="h-10 rounded-full px-6">
                <Plus className="size-4" />
                <span>{importing ? t("library.importing") : t("library.importEpub")}</span>
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <p className="text-muted-foreground">
                {statusFilterOption && statusFilter !== "all"
                  ? t("library.noMatchesInFilter", { filter: t(statusFilterOption.labelKey) })
                  : t("library.noMatches")}
              </p>
              <Button variant="outline" className="h-10 rounded-full px-6" onClick={shelf.handleClearFilters}>
                {t("library.clearFilters")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {recents.length > 0 && (
                <section aria-label={t("library.continueReading")}>
                  <h2 className="px-4 pb-2 text-sm font-medium text-muted-foreground">
                    {t("library.continueReading")}
                  </h2>
                  {/* One card fills the width; more peek in from the right and snap. */}
                  <div
                    data-shelf="recent"
                    className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none]"
                  >
                    {recents.map((book) => (
                      <div
                        key={`recent-${book.id}`}
                        className={cn("shrink-0 snap-start", recents.length > 1 ? "w-[85%]" : "w-full")}
                      >
                        <MobileResumeCard {...itemProps(book)} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {view === "list" ? (
                <div data-shelf="main" className="flex flex-col">
                  {visible.map((book) => (
                    <MobileBookRow key={book.id} {...itemProps(book)} />
                  ))}
                </div>
              ) : (
                <div data-shelf="main" className="grid grid-cols-3 gap-x-4 gap-y-6 px-4 pt-1">
                  {visible.map((book) => (
                    <MobileBookTile key={book.id} {...itemProps(book)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </BookActionSheetProvider>

      {books.length > 0 && (
        <button
          type="button"
          onClick={handleImport}
          disabled={busy}
          aria-label={t("library.importBooks")}
          className="absolute right-4 bottom-[calc(var(--safe-bottom)+1rem)] z-10 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-float transition-transform active:scale-95 disabled:opacity-60 motion-reduce:transition-none"
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}

      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          {/* Drawer and scrim stop at the status bar, so it stays the page's. */}
          <DialogPrimitive.Overlay
            ref={drawerScrimRef}
            className="fixed inset-x-0 top-[var(--safe-top)] bottom-0 z-50 m-fade bg-black/40"
          />
          <DialogPrimitive.Content
            ref={drawerSwipeRef}
            aria-describedby={undefined}
            className="fixed top-[var(--safe-top)] bottom-0 left-0 z-50 flex w-[80%] max-w-xs flex-col rounded-r-2xl bg-background pt-4 pb-[var(--safe-bottom)] shadow-float outline-none m-drawer"
          >
            <DialogPrimitive.Title className="px-6 pb-4 text-xl font-medium">Litera</DialogPrimitive.Title>
            <nav aria-label={t("mobile.drawer")} className="flex flex-col">
              <SheetRow
                icon={Plus}
                label={importing ? t("library.importing") : t("library.importBooks")}
                onClick={handleImport}
                disabled={busy}
              />
              <SheetRow
                icon={Trash2}
                label={t("library.trash")}
                aria-label={t("library.trash")}
                trailing={
                  shelf.trashEntries.length > 0 && (
                    <span className="text-sm text-muted-foreground tabular-nums">{shelf.trashEntries.length}</span>
                  )
                }
                onClick={() => {
                  setDrawerOpen(false);
                  onOpenTrash();
                }}
                disabled={busy}
              />
              <div role="separator" className="mx-6 my-2 h-px bg-border" />
              <SheetRow
                icon={Settings}
                label={t("library.settings")}
                onClick={() => {
                  setDrawerOpen(false);
                  onOpenSettings();
                }}
              />
            </nav>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <MobileSheet open={sortOpen} onOpenChange={setSortOpen} title={t("mobile.sortAndView")}>
        <div className="pb-3">
          <SheetRadioGroup
            label={t("library.sort")}
            value={shelf.sort}
            options={SORT_OPTIONS}
            onChange={shelf.handleSortChange}
          />
          <SheetRadioGroup
            label={t("mobile.order")}
            value={shelf.order}
            options={ORDER_OPTIONS}
            onChange={shelf.handleOrderChange}
          />
          <SheetRadioGroup
            label={t("mobile.view")}
            value={view}
            options={VIEW_OPTIONS}
            onChange={shelf.handleViewChange}
          />
        </div>
      </MobileSheet>

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
