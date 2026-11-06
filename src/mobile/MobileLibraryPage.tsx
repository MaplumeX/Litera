import { useEffect, useRef, useState, type UIEvent } from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import {
  ArrowLeft,
  Check,
  EllipsisVertical,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  ChartColumn,
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
import { BookActionSheetProvider, type BookActionHandlers } from "@/components/BookActionsMenu";
import type { BookRecord } from "@/types/library";
import type { LibraryShelf } from "@/lib/use-library-shelf";
import type { LibrarySortOrder } from "@/lib/library-shelf";
import type { LibraryViewMode } from "@/lib/library-shelf-prefs";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppBarIconButton, MobileAppBar } from "@/mobile/MobileAppBar";
import { MobileBookRow, MobileBookTile } from "@/mobile/MobileBookItems";
import { MobileContinueHero } from "@/mobile/MobileContinueHero";
import { MobileBookActionSheet } from "@/mobile/MobileBookActionSheet";
import { ChoiceChips } from "@/mobile/ChoiceChips";

interface MobileLibraryPageProps {
  shelf: LibraryShelf;
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId: string | null;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  onOpenStats: () => void;
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
 * (search, sort and view menu, overflow menu) under a large title that hands
 * over to it on scroll, filter chips that stick under the app bar, the
 * Continue reading Hero, then the shelf; a floating button imports. The overflow menu holds
 * Trash and Settings; a long-press on a Book opens its actions as a bottom
 * sheet.
 */
export function MobileLibraryPage({
  shelf,
  onOpenBook,
  openingBookId,
  onOpenSettings,
  onOpenTrash,
  onOpenStats,
  searchOpen,
  onSearchOpenChange,
}: MobileLibraryPageProps) {
  const { t } = useT();
  // The Book whose sheet is up, looked up on every render so it shows the
  // star and status as they change (and closes if the Book goes).
  const [actionsBookId, setActionsBookId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const largeTitleRef = useRef<HTMLParagraphElement>(null);
  // The large title has scrolled under the app bar, which takes the title over.
  const [scrolledPast, setScrolledPast] = useState(false);
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

  const largeTitle = !searchOpen && books.length > 0;
  const titleCollapsed = !largeTitle || scrolledPast;
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const title = largeTitleRef.current;
    setScrolledPast(title !== null && event.currentTarget.scrollTop >= title.offsetHeight - 8);
  };

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
          title={
            // Stays the page's heading for screen readers while the large title shows it.
            <span
              className={cn(
                "transition-opacity duration-150 motion-reduce:transition-none",
                !titleCollapsed && "opacity-0",
              )}
            >
              {t("mobile.shelf")}
            </span>
          }
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
                  <DropdownMenuItem className={MENU_ITEM} onSelect={onOpenStats}>
                    <ChartColumn className="size-5" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{t("stats.title")}</span>
                  </DropdownMenuItem>
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

      <BookActionSheetProvider value={openActionSheet}>
        {/* Bottom padding clears the floating import button. */}
        <div
          onScroll={largeTitle ? handleScroll : undefined}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[calc(var(--safe-bottom)+6rem)]"
        >
          {largeTitle && (
            <p
              ref={largeTitleRef}
              aria-hidden
              className="shrink-0 px-4 pt-1 pb-2 text-[1.75rem] leading-9 font-semibold tracking-[-0.022em] select-none"
            >
              {t("mobile.shelf")}
            </p>
          )}
          {books.length > 0 && (
            // Sticks under the app bar, so the filter in force stays in view.
            <ChoiceChips
              ariaLabel={t("library.statusFilter")}
              value={statusFilter}
              options={STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
              onChange={shelf.handleStatusFilterChange}
              className={cn(
                "sticky top-0 z-10 shrink-0 bg-background px-4 pt-1 pb-3 transition-shadow motion-reduce:transition-none",
                // Once the shelf runs under it, a hairline parts the two.
                scrolledPast && "shadow-[0_1px_0_var(--border)]",
              )}
            />
          )}
          {!loaded ? null : books.length === 0 && loadError ? (
            <div className="flex flex-1 items-center justify-center px-8">
              <p role="alert" className="text-center break-words text-sm text-destructive">
                {t("library.loadFailed", { message: loadError })}
              </p>
            </div>
          ) : books.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <p className="text-muted-foreground">{t("library.empty")}</p>
              <Button onClick={handleImport} disabled={busy} className="h-10 rounded-full px-6">
                <Plus className="size-4" />
                <span>{importing ? t("library.importing") : t("library.importEpub")}</span>
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
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
                <MobileContinueHero
                  books={recents}
                  actionsFor={actionsFor}
                  coverRev={coverRev}
                  openingBookId={openingBookId}
                  disabled={importing}
                />
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
