import { Check, Plus } from "lucide-react";
import type { BookRecord, ReadingStatus } from "@/types/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";

/** A status choice in the menu, or "unset" for a book that has none. */
export type BookStatusChoice = ReadingStatus | "unset";

const CHOICES: BookStatusChoice[] = ["unset", "unread", "reading", "finished"];

const STATUS_LABEL_KEYS: Record<BookStatusChoice, MessageKey> = {
  unset: "library.status.unset",
  unread: "library.status.unread",
  reading: "library.status.reading",
  finished: "library.status.finished",
};

/**
 * The reading-status control: a label that opens a menu of the four choices.
 *
 * A book with no status still gets a dimmed placeholder trigger, because this
 * is the only place a status can be set — an invisible entry point would leave
 * un-curated books with no way in. It owns no IPC: the host supplies
 * `onChange`, so the card and the list row share one implementation and the
 * menu can be tested without the shelf.
 */
export function BookStatusMenu({
  book,
  onChange,
  className,
}: {
  book: BookRecord;
  onChange: (choice: BookStatusChoice) => void;
  className?: string;
}) {
  const { t } = useT();
  const current: BookStatusChoice = book.readingStatus ?? "unset";
  const currentLabel = t(STATUS_LABEL_KEYS[current]);
  const unset = current === "unset";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`${t("library.fieldReadingStatus")}: ${currentLabel}`}
          className={cn(
            "inline-flex max-w-full items-center gap-0.5 rounded-sm px-1 py-px text-[10px] transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            unset
              ? "border border-dashed border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/60 hover:text-muted-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            className,
          )}
        >
          {unset && <Plus className="size-2.5 shrink-0" aria-hidden />}
          <span className="truncate">
            {unset ? t("library.status.add") : currentLabel}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CHOICES.map((choice) => (
          <DropdownMenuItem key={choice} onSelect={() => onChange(choice)}>
            <Check
              className={cn("size-4", choice === current ? "opacity-100" : "opacity-0")}
            />
            {t(STATUS_LABEL_KEYS[choice])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
