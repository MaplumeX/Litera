import { useRef } from "react";
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
import type { LibraryStatusFilter } from "@/lib/library-shelf";

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

/** Each status's chip tint and dot, kept low-chroma so the chip never outweighs the title. */
const STATUS_TONES: Record<ReadingStatus, { chip: string; dot: string }> = {
  unread: {
    chip: "bg-muted text-muted-foreground ring-border/70",
    dot: "border border-muted-foreground/60",
  },
  reading: {
    chip: "bg-primary/[0.06] text-foreground/75 ring-primary/15",
    dot: "bg-primary/70",
  },
  paused: {
    chip: "bg-amber-500/10 text-amber-800 ring-amber-600/20 dark:text-amber-300 dark:ring-amber-400/20",
    dot: "bg-amber-500",
  },
  finished: {
    chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-700/20 dark:text-emerald-300 dark:ring-emerald-400/20",
    dot: "bg-emerald-600 dark:bg-emerald-400",
  },
};

/**
 * The reading-status control: a label that opens a menu of the statuses.
 *
 * The label stays visible only when it tells the reader something the card
 * does not: Paused and Finished. Unread (every new import) and Reading (the
 * progress bar says it) show only on hover, focus, or while the menu is open,
 * as does any status the shelf is already filtered to. The host must carry
 * Tailwind's `group` class. It
 * owns no IPC: the host supplies `onChange`, so the card and the list row
 * share one implementation and the menu can be tested without the shelf.
 */
export function BookStatusMenu({
  book,
  onChange,
  statusFilter,
  className,
}: {
  book: BookRecord;
  onChange: (status: ReadingStatus) => void;
  /** The shelf's active filter: a chip naming it would repeat on every card. */
  statusFilter?: LibraryStatusFilter;
  className?: string;
}) {
  const { t } = useT();
  // A pointer-opened menu should not hand focus back to the chip on close:
  // the restored focus reads as focus-visible and pins a quiet chip on screen.
  const openedByPointer = useRef(false);
  const current = book.readingStatus;
  const currentLabel = t(STATUS_LABEL_KEYS[current]);
  const tone = STATUS_TONES[current] ?? STATUS_TONES.unread;
  const quiet =
    current === "unread" || current === "reading" || current === statusFilter;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          onPointerDown={() => {
            openedByPointer.current = true;
          }}
          onKeyDown={() => {
            openedByPointer.current = false;
          }}
          aria-label={`${t("library.fieldReadingStatus")}: ${currentLabel}`}
          className={cn(
            "inline-flex h-5 max-w-full items-center gap-1 rounded-full px-2 text-[11px] font-medium leading-none tracking-wide ring-1 ring-inset transition-[filter,opacity] hover:brightness-95 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110",
            tone.chip,
            quiet &&
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
            className,
          )}
        >
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
          <span className="truncate">{currentLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          if (openedByPointer.current) event.preventDefault();
        }}
      >
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
