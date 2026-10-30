import { BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { highlightColorHex } from "@/lib/annotations";
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
    <nav
      aria-label={t("annotations.title")}
      className="flex h-full w-full flex-col overflow-hidden"
    >
      {/* Sections are set apart by space, not rules. */}
      <div className="flex-1 space-y-5 overflow-y-auto pb-3">
        <section>
          <div className="flex items-center justify-between px-4 pb-1">
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
                <Tip label={bookmarkLabel(bookmark)} side="right" overflowOnly>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent/70 motion-reduce:transition-none hover:text-accent-foreground"
                    onClick={() => onJumpBookmark(bookmark)}
                  >
                    {bookmarkLabel(bookmark)}
                  </button>
                </Tip>
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
        <section>
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
                <Tip label={highlight.excerpt} side="right" overflowOnly>
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent/70 motion-reduce:transition-none hover:text-accent-foreground"
                    onClick={() => onJumpHighlight(highlight)}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: highlightColorHex(highlight.color) }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2">{highlight.excerpt}</span>
                        {highlight.note?.trim() ? (
                          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {highlight.note}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </Tip>
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
