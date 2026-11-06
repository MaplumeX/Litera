import { useEffect, useRef, type ReactNode } from "react";
import {
  Book,
  BookCheck,
  BookOpen,
  ChartColumn,
  Library,
  Pause,
  Plus,
  Settings,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { STATUS_OPTIONS } from "@/components/LibraryShelfToolbar";
import { NAV_ITEM_ACTIVE_CLASS, NAV_ITEM_CLASS, NAV_ITEM_IDLE_CLASS } from "@/components/ui/nav-item";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { LibraryStatusFilter } from "@/lib/library-shelf";

const FILTER_ICONS: Record<LibraryStatusFilter, LucideIcon> = {
  all: Library,
  unread: Book,
  reading: BookOpen,
  paused: Pause,
  finished: BookCheck,
  starred: Star,
};


interface LibrarySidebarProps {
  statusFilter: LibraryStatusFilter;
  /** Per-filter counts over the current search result. */
  counts: Record<LibraryStatusFilter, number>;
  onStatusFilterChange: (value: LibraryStatusFilter) => void;
  onImport: () => void;
  importing: boolean;
  trashCount: number;
  onOpenTrash: () => void;
  /** The Reading stats page is showing, in place of the shelf. */
  statsActive?: boolean;
  onOpenStats?: () => void;
  busy: boolean;
  /** Move focus to the active filter on mount, for the narrow-window drawer. */
  autoFocus?: boolean;
  /** Titlebar row on top, when the sidebar runs the window's full height. */
  header?: ReactNode;
  /** The mobile drawer also leads to Settings; desktop has it in the titlebar. */
  onOpenSettings?: () => void;
  /** Width in px when docked; the drawer keeps the default. */
  width?: number;
  className?: string;
}

/**
 * The shelf's navigation: status filters on top, the rare global actions
 * (Import, Trash) pinned to the bottom. Every item is always present, so
 * nothing shifts as counts change; a zero count shows nothing. Groups are
 * set apart by space and the sidebar by its tone, not by rules.
 */
export function LibrarySidebar({
  statusFilter,
  counts,
  onStatusFilterChange,
  onImport,
  importing,
  trashCount,
  onOpenTrash,
  statsActive = false,
  onOpenStats,
  busy,
  autoFocus = false,
  header,
  onOpenSettings,
  width,
  className,
}: LibrarySidebarProps) {
  const { t } = useT();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) activeRef.current?.focus();
  }, [autoFocus]);

  return (
    <aside
      className={cn(
        "flex w-52 shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        className,
      )}
      style={width === undefined ? undefined : { width }}
    >
      {header}
      <nav
        aria-label={t("library.statusFilter")}
        className={cn("flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2", header && "pt-1")}
      >
        {STATUS_OPTIONS.map((option) => {
          const active = !statsActive && option.value === statusFilter;
          const Icon = FILTER_ICONS[option.value];
          const count = counts[option.value];
          return (
            <button
              key={option.value}
              ref={active ? activeRef : undefined}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onStatusFilterChange(option.value)}
              className={cn(
                NAV_ITEM_CLASS,
                // Starred is orthogonal to Reading status, not a fifth status.
                option.value === "starred" && "mt-3.5",
                active
                  ? NAV_ITEM_ACTIVE_CLASS
                  : NAV_ITEM_IDLE_CLASS,
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">
                {t(option.labelKey)}
              </span>
              {count > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {count}
                </span>
              ) : (
                <span className="sr-only">0</span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="flex flex-col gap-px p-2">
        {onOpenStats && (
          <button
            type="button"
            aria-current={statsActive ? "page" : undefined}
            onClick={onOpenStats}
            className={cn(
              NAV_ITEM_CLASS,
              statsActive
                ? NAV_ITEM_ACTIVE_CLASS
                : NAV_ITEM_IDLE_CLASS,
            )}
          >
            <ChartColumn className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">{t("stats.title")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className={cn(NAV_ITEM_CLASS, NAV_ITEM_IDLE_CLASS)}
        >
          <Plus className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">
            {importing ? t("library.importing") : t("library.importBooks")}
          </span>
        </button>
        {/* Always present so its position is stable; an empty Trash opens
            the dialog's empty state. */}
        <button
          type="button"
          aria-label={t("library.trash")}
          data-trash-count={trashCount}
          onClick={onOpenTrash}
          disabled={busy}
          className={cn(NAV_ITEM_CLASS, NAV_ITEM_IDLE_CLASS)}
        >
          <Trash2 className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">
            {t("library.trash")}
          </span>
          {trashCount > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {trashCount}
            </span>
          )}
        </button>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className={cn(NAV_ITEM_CLASS, NAV_ITEM_IDLE_CLASS)}
          >
            <Settings className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">{t("library.settings")}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
