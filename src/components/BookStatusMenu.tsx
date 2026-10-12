import { Check } from "lucide-react";
import type { BookRecord, ReadingStatus } from "@/types/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";

/** The statuses in menu order. */
export const READING_STATUSES: readonly ReadingStatus[] = [
  "unread",
  "reading",
  "paused",
  "finished",
];

export const STATUS_LABEL_KEYS: Record<ReadingStatus, MessageKey> = {
  unread: "library.status.unread",
  reading: "library.status.reading",
  paused: "library.status.paused",
  finished: "library.status.finished",
};

/**
 * The reading-status control: a label that opens a menu of the statuses.
 *
 * An unread Book's label only shows on hover, focus, or while its menu is
 * open: every new import is unread, so a fresh shelf would otherwise carry the
 * same chip on every card. The host must carry Tailwind's `group` class. It
 * owns no IPC: the host supplies `onChange`, so the card and the list row
 * share one implementation and the menu can be tested without the shelf.
 */
export function BookStatusMenu({
  book,
  onChange,
  className,
}: {
  book: BookRecord;
  onChange: (status: ReadingStatus) => void;
  className?: string;
}) {
  const { t } = useT();
  const current = book.readingStatus;
  const currentLabel = t(STATUS_LABEL_KEYS[current]);
  const quiet = current === "unread";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`${t("library.fieldReadingStatus")}: ${currentLabel}`}
          className={cn(
            "inline-flex max-w-full items-center gap-0.5 rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            quiet &&
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
            className,
          )}
        >
          <span className="truncate">{currentLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {READING_STATUSES.map((status) => (
          <DropdownMenuItem key={status} onSelect={() => onChange(status)}>
            <Check
              className={cn("size-4", status === current ? "opacity-100" : "opacity-0")}
            />
            {t(STATUS_LABEL_KEYS[status])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
