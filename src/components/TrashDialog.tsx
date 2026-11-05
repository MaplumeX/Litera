import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import type { TrashEntry } from "@/types/library";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { paletteFromText, paletteStyle } from "@/lib/cover-palette";
import { formatLibraryTimestamp } from "@/lib/library-shelf";
import { formatByteSize } from "@/lib/trash";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function TrashCover({ entry }: { entry: TrashEntry }) {
  const [failed, setFailed] = useState(false);
  if (entry.coverPath && !failed) {
    return (
      <img
        src={convertFileSrc(entry.coverPath)}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className="generated-cover"
      style={paletteStyle(paletteFromText(entry.title))}
      data-small
      data-title={entry.title.charAt(0) || "?"}
    />
  );
}

/** The Trash's entries, shared by the desktop dialog and the mobile Trash page. */
export function TrashEntryList({
  entries,
  onRestore,
  onPurge,
  className,
}: {
  entries: TrashEntry[];
  onRestore: (entry: TrashEntry) => void;
  onPurge: (entry: TrashEntry) => void;
  /** Overrides the list's height cap (a page scrolls on its own). */
  className?: string;
}) {
  const { t, locale } = useT();
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span aria-hidden className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Trash2 className="size-5" />
        </span>
        <p className="text-sm text-muted-foreground">{t("library.trashEmpty")}</p>
      </div>
    );
  }
  return (
    <ul className={cn("-mx-2 flex max-h-80 flex-col gap-px overflow-y-auto", className)}>
      {entries.map((entry) => (
        <li
          key={entry.entryId}
          className="flex items-center gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-muted/70 motion-reduce:transition-none"
        >
          <span className="h-14 w-10 shrink-0 overflow-hidden rounded-cover bg-muted shadow-cover">
            <TrashCover entry={entry} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {entry.title || t("library.trashUnnamed")}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {[
                entry.author,
                entry.deletedAt
                  ? formatLibraryTimestamp(entry.deletedAt, locale)
                  : null,
                formatByteSize(entry.sizeBytes, locale),
                entry.hasSessions ? t("library.trashSessions") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {entry.origin === "sync" && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("library.trashSyncOrigin")}
              </span>
            )}
          </span>
          {entry.restorable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRestore(entry)}
            >
              {t("library.trashRestore")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
            onClick={() => onPurge(entry)}
          >
            {t("library.trashPurge")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

interface TrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: TrashEntry[];
  /** Restore is only offered when `entry.restorable`. */
  onRestore: (entry: TrashEntry) => void;
  onPurge: (entry: TrashEntry) => void;
  onPurgeAll: () => void;
}

/**
 * The recovery window `delete_book` leaves behind. Entries deleted by another
 * device's Tombstone are listed with their reason but cannot be restored:
 * the next Sync would only delete them again.
 */
export function TrashDialog({
  open,
  onOpenChange,
  entries,
  onRestore,
  onPurge,
  onPurgeAll,
}: TrashDialogProps) {
  const { t } = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("library.trashTitle")}</DialogTitle>
          <DialogDescription>{t("library.trashDescription")}</DialogDescription>
        </DialogHeader>

        <TrashEntryList entries={entries} onRestore={onRestore} onPurge={onPurge} />

        <DialogFooter className="sm:justify-between">
          {entries.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
              onClick={onPurgeAll}
            >
              {t("library.trashPurgeAll")}
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
