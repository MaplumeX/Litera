import type { ReactNode } from "react";
import { BookOpen, Check, Info, Star, Trash2, type LucideIcon } from "lucide-react";
import type { BookRecord } from "@/types/library";
import type { BookActionHandlers } from "@/components/BookActionsMenu";
import { BookCoverImage } from "@/components/BookCard";
import { READING_STATUSES, STATUS_LABEL_KEYS } from "@/components/BookStatusMenu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppBarIconButton } from "@/mobile/MobileAppBar";
import { useProgressCaption } from "@/mobile/MobileBookItems";
import { MobileSheet } from "@/mobile/MobileSheet";

function ActionRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: LucideIcon;
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-14 w-full items-center gap-4 px-6 text-left text-[0.9375rem] transition-colors active:bg-foreground/5 disabled:opacity-50 motion-reduce:transition-none",
        destructive && "text-destructive",
      )}
    >
      <Icon className={cn("size-5 shrink-0", !destructive && "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * A Book's long-press sheet on the phone: the Book itself on top (cover,
 * title, author, progress, and its star), its Reading status as chips, then
 * open, details and delete. Starring and the status apply in place and
 * leave the sheet up; the other rows close it.
 */
export function MobileBookActionSheet({
  book,
  actions,
  coverRev,
  onClose,
}: {
  /** Null closes the sheet. */
  book: BookRecord | null;
  actions: BookActionHandlers | null;
  coverRev?: number;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <MobileSheet
      open={book !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("mobile.bookActions", { title: book?.title ?? "" })}
      hideTitle
    >
      {book && actions && <SheetBody book={book} actions={actions} coverRev={coverRev} onClose={onClose} />}
    </MobileSheet>
  );
}

function SheetBody({
  book,
  actions,
  coverRev,
  onClose,
}: {
  book: BookRecord;
  actions: BookActionHandlers;
  coverRev?: number;
  onClose: () => void;
}) {
  const { t } = useT();
  const caption = useProgressCaption(book, false);
  const started = (book.lastFraction ?? 0) > 0;
  const andClose = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <div className="pb-2">
      <div className="flex items-start gap-4 pt-1 pr-2 pb-4 pl-6">
        <span className="relative block h-24 w-16 shrink-0 overflow-hidden rounded-cover bg-muted shadow-cover">
          <BookCoverImage book={book} coverRev={coverRev} small />
        </span>
        <div className="flex min-w-0 flex-1 flex-col self-stretch py-0.5">
          <p className="line-clamp-2 text-base leading-6 font-medium">{book.title}</p>
          {book.author && <p className="mt-0.5 truncate text-sm text-muted-foreground">{book.author}</p>}
          <p className="mt-auto pt-2 text-xs text-muted-foreground tabular-nums">{caption}</p>
        </div>
        {actions.onToggleStar && (
          <AppBarIconButton
            label={t("library.star")}
            aria-pressed={book.starred === true}
            onClick={actions.onToggleStar}
            className={cn("-mt-1", book.starred && "text-primary")}
          >
            <Star className={cn(book.starred && "fill-current")} />
          </AppBarIconButton>
        )}
      </div>

      {actions.onChangeStatus && (
        <div className="border-t px-6 pt-3 pb-4">
          <h3 className="pb-2 text-xs font-medium text-muted-foreground">{t("library.fieldReadingStatus")}</h3>
          <div role="radiogroup" aria-label={t("library.fieldReadingStatus")} className="flex flex-wrap gap-2">
            {READING_STATUSES.map((status) => {
              const active = status === book.readingStatus;
              return (
                <button
                  key={status}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => actions.onChangeStatus?.(status)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors motion-reduce:transition-none",
                    active
                      ? "border-transparent bg-secondary font-medium text-secondary-foreground"
                      : "border-border text-foreground/80 active:bg-foreground/5",
                  )}
                >
                  {active && <Check className="size-4" aria-hidden />}
                  {t(STATUS_LABEL_KEYS[status])}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t pt-1">
        <ActionRow
          icon={BookOpen}
          label={t(started ? "library.continueReading" : "mobile.startReading")}
          onClick={andClose(actions.onOpen)}
        />
        <ActionRow icon={Info} label={t("library.details")} onClick={andClose(actions.onDetails)} />
        <ActionRow
          icon={Trash2}
          label={t("library.deleteEllipsis")}
          onClick={andClose(actions.onDelete)}
          disabled={actions.deleteDisabled}
          destructive
        />
      </div>
    </div>
  );
}
