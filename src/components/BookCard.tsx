import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
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
          "relative aspect-[2/3] w-full overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow hover:shadow-md",
          selectMode && selected && "ring-2 ring-primary",
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
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/60">
            <span className="text-4xl font-bold text-muted-foreground/40">
              {initial}
            </span>
          </div>
        )}
        {progressPct != null && !opening && (
          <>
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
              <span
                className="block h-full bg-primary"
                style={{ width: `${progressPct}%` }}
              />
            </span>
            <span className="absolute bottom-1.5 right-1.5 rounded bg-background/85 px-1 py-px text-[10px] font-medium tabular-nums">
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
              "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-background/80 shadow-sm",
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
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-destructive opacity-0 shadow-sm transition-opacity hover:bg-background group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(book.id);
          }}
          disabled={deleteDisabled}
          title={t("common.delete")}
        >
          ✕
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
