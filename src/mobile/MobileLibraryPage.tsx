import { useEffect, useRef, useState } from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import {
  ArrowLeft,
  Check,
  EllipsisVertical,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bookActions } from "@/components/BookCard";
import { BookDetailsDialog } from "@/components/BookDetailsDialog";
import { SORT_OPTIONS, STATUS_OPTIONS } from "@/components/LibraryShelfToolbar";
import { BookImportNotices } from "@/components/BookImportFeedback";
import { BookActionSheetProvider, type BookActionHandlers } from "@/components/BookActionsMenu";
import type { BookRecord } from "@/types/library";
import type { LibraryShelf } from "@/lib/use-library-shelf";
import type { LibrarySortOrder } from "@/lib/library-shelf";
import type { LibraryViewMode } from "@/lib/library-shelf-prefs";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppBarIconButton, MobileAppBar } from "@/mobile/MobileAppBar";
import { MobileBookRow, MobileBookTile, MobileResumeCard } from "@/mobile/MobileBookItems";
import { MobileBookActionSheet } from "@/mobile/MobileBookActionSheet";

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

/** An app bar menu's row: a 48dp touch target. */
const MENU_ITEM = "min-h-12 gap-4 px-4 text-[0.9375rem]";

const ORDER_OPTIONS: { value: LibrarySortOrder; labelKey: MessageKey }[] = [
  { value: "asc", labelKey: "library.sortAscending" },
  { value: "desc", labelKey: "library.sortDescending" },
];

const VIEW_OPTIONS: { value: LibraryViewMode; labelKey: MessageKey }[] = [
  { value: "grid", labelKey: "library.viewGrid" },
  { value: "list", labelKey: "library.viewList" },
];

/**
 * A titled group of choices in a menu, the picked one ticked. Picking keeps
 * the menu open, so sort, order and view can all change in one visit.
 */
function MenuRadioGroup<T extends string>({
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
    <DropdownMenuRadioGroup aria-label={label} value={value} onValueChange={(next) => onChange(next as T)}>
      <DropdownMenuLabel className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">{label}</DropdownMenuLabel>
      {options.map((option) => (
        <DropdownMenuPrimitive.RadioItem
          key={option.value}
          value={option.value}
          onSelect={(event) => event.preventDefault()}
          className={cn(
            "relative flex cursor-default items-center rounded-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[state=checked]:font-medium",
            MENU_ITEM,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{t(option.labelKey)}</span>
          <DropdownMenuPrimitive.ItemIndicator>
            <Check className="size-5 text-primary" aria-hidden />
          </DropdownMenuPrimitive.ItemIndicator>
        </DropdownMenuPrimitive.RadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/**
 * The phone's Library, laid out like other Android readers: a top app bar
 * (search, sort and view menu, overflow menu), filter chips, the Books you're reading as
 * cards, then the shelf; a floating button imports. The overflow menu holds
 * Trash and Settings; a long-press on a Book opens its actions as a bottom
 * sheet.
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
  // The Book whose sheet is up, looked up on every render so it shows the
  // star and status as they change (and closes if the Book goes).
  const [actionsBookId, setActionsBookId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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

  const actionsBook = (actionsBookId && books.find((book) => book.id === actionsBookId)) || null;
  const openActionSheet = (actions: BookActionHandlers) => setActionsBookId(actions.bookId ?? null);

  const itemProps = (book: BookRecord) => ({
    book,
    actions: actionsFor(book),
    opening: openingBookId === book.id,
    disabled: importing,
    coverRev: coverRev[book.id],
  });

  const handleImport = () => void shelf.handleImport();

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
          title={t("mobile.shelf")}
          actions={
            <>
              <AppBarIconButton label={t("mobile.searchLibrary")} onClick={() => onSearchOpenChange(true)}>
                <Search />
              </AppBarIconButton>
              {books.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <AppBarIconButton label={t("mobile.sortAndView")}>
                      <SlidersHorizontal />
                    </AppBarIconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52 py-1">
                    <MenuRadioGroup
                      label={t("library.sort")}
                      value={shelf.sort}
                      options={SORT_OPTIONS}
                      onChange={shelf.handleSortChange}
                    />
                    <DropdownMenuSeparator />
                    <MenuRadioGroup
                      label={t("mobile.order")}
                      value={shelf.order}
                      options={ORDER_OPTIONS}
                      onChange={shelf.handleOrderChange}
                    />
                    <DropdownMenuSeparator />
                    <MenuRadioGroup
                      label={t("mobile.view")}
                      value={view}
                      options={VIEW_OPTIONS}
                      onChange={shelf.handleViewChange}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <AppBarIconButton label={t("mobile.menu")}>
                    <EllipsisVertical />
                  </AppBarIconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48 py-2">
                  <DropdownMenuItem className={MENU_ITEM} disabled={busy} onSelect={onOpenTrash}>
                    <Trash2 className="size-5" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{t("library.trash")}</span>
                    {shelf.trashEntries.length > 0 && (
                      <span className="text-sm text-muted-foreground tabular-nums">{shelf.trashEntries.length}</span>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem className={MENU_ITEM} onSelect={onOpenSettings}>
                    <Settings className="size-5" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{t("library.settings")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      )}

      {books.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t("library.statusFilter")}
          className="flex shrink-0 gap-2 overflow-x-auto px-4 pt-1 pb-3 no-scrollbar"
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

      <BookActionSheetProvider value={openActionSheet}>
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
                    className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 no-scrollbar"
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

      <MobileBookActionSheet
        book={actionsBook}
        actions={actionsBook && actionsFor(actionsBook)}
        coverRev={actionsBook ? coverRev[actionsBook.id] : undefined}
        onClose={() => setActionsBookId(null)}
      />

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
