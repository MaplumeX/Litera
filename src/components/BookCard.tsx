import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Check, X } from "lucide-react";
import type { BookRecord } from "@/types/library";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

interface BookCardProps {
  book: BookRecord;
  onOpen: (bookId: string) => void | Promise<void>;
  onDelete: (bookId: string) => void;
  opening?: boolean;
  deleteDisabled?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (bookId: string) => void;
  openDisabled?: boolean;
}

export function BookCard({
  book,
  onOpen,
  onDelete,
  opening = false,
  deleteDisabled = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
  openDisabled = false,
}: BookCardProps) {
  const { t } = useT();
  const [imgError, setImgError] = useState(false);

  const coverSrc = book.coverPath ? convertFileSrc(book.coverPath) : null;
  const showCover = coverSrc && !imgError;
  const initial = book.title.charAt(0) || "?";
  const progressPct =
    book.lastFraction == null ? null : Math.round(book.lastFraction * 100);

  return (
    <div className="group relative flex flex-col gap-2">
      {/* Cover */}
      <button
        className={cn(
          "relative aspect-[2/3] w-full overflow-hidden rounded-md border bg-muted transition-[border-color,transform,opacity] duration-200 hover:border-foreground/25 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
          selectMode && selected && "ring-1 ring-primary",
        )}
        onClick={() => {
          if (selectMode) {
            onToggleSelect?.(book.id);
            return;
          }
          void onOpen(book.id);
        }}
        disabled={(opening || openDisabled) && !selectMode}
        title={book.title}
        aria-pressed={selectMode ? selected : undefined}
      >
        {showCover ? (
          <img
            src={coverSrc!}
            alt={book.title}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <span className="text-4xl font-medium text-muted-foreground/40">
              {initial}
            </span>
          </div>
        )}
        {progressPct != null && !opening && (
          <>
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/15">
              <span
                className="block h-full bg-primary"
                style={{ width: `${progressPct}%` }}
              />
            </span>
            <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-background/80 px-1 py-px text-[10px] font-medium tabular-nums text-foreground/80">
              {progressPct}%
            </span>
          </>
        )}
        {opening && !selectMode && (
          <span className="absolute inset-x-0 bottom-0 bg-background/90 px-2 py-1 text-xs font-medium">
            {t("library.opening")}
          </span>
        )}
        {selectMode && (
          <span
            className={cn(
              "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-sm border border-background/80",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-background/80 text-transparent",
            )}
          >
            <Check className="size-3" />
          </span>
        )}
      </button>

      {/* Delete button (visible on hover, hidden in select mode) */}
      {!selectMode && (
        <button
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground opacity-0 transition-opacity duration-200 hover:bg-muted hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(book.id);
          }}
          disabled={deleteDisabled}
          title={t("common.delete")}
          aria-label={t("common.delete")}
        >
          <X className="size-3.5" />
        </button>
      )}

      {/* Title + Author */}
      <div className="px-1">
        <p className={cn("line-clamp-2 text-sm font-medium leading-tight")}>
          {book.title}
        </p>
        {book.author && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {book.author}
          </p>
        )}
      </div>
    </div>
  );
}
