import { useEffect, useRef, type ReactNode } from "react";
import {
  Book,
  BookCheck,
  BookOpen,
  Library,
  Pause,
  Plus,
  Settings,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { STATUS_OPTIONS } from "@/components/LibraryShelfToolbar";
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

const ITEM_CLASS =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none";

const IDLE_ITEM_CLASS =
  "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground";

interface LibrarySidebarProps {
  statusFilter: LibraryStatusFilter;
  /** Per-filter counts over the current search result. */
  counts: Record<LibraryStatusFilter, number>;
  onStatusFilterChange: (value: LibraryStatusFilter) => void;
  onImport: () => void;
  importing: boolean;
  trashCount: number;
  onOpenTrash: () => void;
  busy: boolean;
  /** Move focus to the active filter on mount, for the narrow-window drawer. */
  autoFocus?: boolean;
  /** Titlebar row on top, when the sidebar runs the window's full height. */
  header?: ReactNode;
  /** The mobile drawer also leads to Settings; desktop has it in the titlebar. */
  onOpenSettings?: () => void;
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
  busy,
  autoFocus = false,
  header,
  onOpenSettings,
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
    >
      {header}
      <nav
        aria-label={t("library.statusFilter")}
        className={cn("min-h-0 flex-1 overflow-y-auto p-2", header && "pt-1")}
      >
        {STATUS_OPTIONS.map((option) => {
          const active = option.value === statusFilter;
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
                ITEM_CLASS,
                // Starred is orthogonal to Reading status, not a fifth status.
                option.value === "starred" && "mt-4",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : IDLE_ITEM_CLASS,
              )}
            >
              <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
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
      <div className="p-2">
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className={cn(ITEM_CLASS, IDLE_ITEM_CLASS)}
        >
          <Plus className="size-4 shrink-0 opacity-70" aria-hidden />
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
          className={cn(ITEM_CLASS, IDLE_ITEM_CLASS)}
        >
          <Trash2 className="size-4 shrink-0 opacity-70" aria-hidden />
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
            className={cn(ITEM_CLASS, IDLE_ITEM_CLASS)}
          >
            <Settings className="size-4 shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">{t("library.settings")}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
