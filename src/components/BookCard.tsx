import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { BookRecord } from "@/types/library";
import { cn } from "@/lib/utils";

interface BookCardProps {
  book: BookRecord;
  onOpen: (bookId: string) => void;
  onDelete: (bookId: string) => void;
}

export function BookCard({ book, onOpen, onDelete }: BookCardProps) {
  const [imgError, setImgError] = useState(false);

  const coverSrc = book.coverPath ? convertFileSrc(book.coverPath) : null;
  const showCover = coverSrc && !imgError;
  const initial = book.title.charAt(0) || "?";

  return (
    <div className="group relative flex flex-col gap-2">
      {/* Cover */}
      <button
        className="relative aspect-[2/3] w-full overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow hover:shadow-md"
        onClick={() => onOpen(book.id)}
        title={book.title}
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
      </button>

      {/* Delete button (visible on hover) */}
      <button
        className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-destructive opacity-0 shadow-sm transition-opacity hover:bg-background group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`确定删除「${book.title}」？`)) {
            onDelete(book.id);
          }
        }}
        title="删除"
      >
        ✕
      </button>

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