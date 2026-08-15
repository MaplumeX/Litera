import { BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import type { BookmarkRecord, HighlightRecord } from "@/types/library";

interface AnnotationsSidebarProps {
  bookmarks: BookmarkRecord[];
  highlights: HighlightRecord[];
  onAddBookmark: () => void;
  onJumpBookmark: (bookmark: BookmarkRecord) => void;
  onDeleteBookmark: (id: string) => void;
  onJumpHighlight: (highlight: HighlightRecord) => void;
  onDeleteHighlight: (id: string) => void;
}

function bookmarkLabel(bookmark: BookmarkRecord): string {
  if (bookmark.label?.trim()) return bookmark.label;
  return `${Math.round(bookmark.fraction * 100)}%`;
}

export function AnnotationsSidebar({
  bookmarks,
  highlights,
  onAddBookmark,
  onJumpBookmark,
  onDeleteBookmark,
  onJumpHighlight,
  onDeleteHighlight,
}: AnnotationsSidebarProps) {
  const { t } = useT();
  return (
    <nav className="flex h-full w-full flex-col overflow-hidden">
      <div className="border-b px-4 py-3 text-sm font-medium">{t("annotations.title")}</div>
      <div className="flex-1 overflow-y-auto py-1">
        <section className="border-b py-3">
          <div className="flex items-center justify-between px-4 pb-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              {t("annotations.bookmarks")}
            </h2>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={onAddBookmark}
              aria-label={t("annotations.addBookmark")}
            >
              <BookmarkPlus />
              {t("annotations.addBookmark")}
            </Button>
          </div>
          {bookmarks.length === 0 ? (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              {t("annotations.emptyBookmarks")}
            </div>
          ) : (
            bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="flex items-start gap-0.5 px-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title={bookmarkLabel(bookmark)}
                  onClick={() => onJumpBookmark(bookmark)}
                >
                  {bookmarkLabel(bookmark)}
                </button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("annotations.deleteBookmark")}
                  onClick={() => onDeleteBookmark(bookmark.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </section>
        <section className="py-3">
          <h2 className="px-4 pb-2 text-xs font-medium text-muted-foreground">
            {t("annotations.highlights")}
          </h2>
          {highlights.length === 0 ? (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              {t("annotations.emptyHighlights")}
            </div>
          ) : (
            highlights.map((highlight) => (
              <div key={highlight.id} className="flex items-start gap-0.5 px-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title={highlight.excerpt}
                  onClick={() => onJumpHighlight(highlight)}
                >
                  <span className="line-clamp-2">{highlight.excerpt}</span>
                </button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("annotations.deleteHighlight")}
                  onClick={() => onDeleteHighlight(highlight.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </section>
      </div>
    </nav>
  );
}
