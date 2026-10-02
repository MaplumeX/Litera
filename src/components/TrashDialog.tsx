import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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
import { formatLibraryTimestamp } from "@/lib/library-shelf";
import { formatByteSize } from "@/lib/trash";
import { useT } from "@/lib/i18n";

function TrashCover({ entry }: { entry: TrashEntry }) {
  const [failed, setFailed] = useState(false);
  const initial = entry.title.charAt(0) || "?";
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
    <span className="flex h-full w-full items-center justify-center bg-muted text-lg font-medium text-muted-foreground/40">
      {initial}
    </span>
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
  const { t, locale } = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("library.trashTitle")}</DialogTitle>
          <DialogDescription>{t("library.trashDescription")}</DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("library.trashEmpty")}
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {entries.map((entry) => (
              <li
                key={entry.entryId}
                className="flex items-center gap-3 rounded-md border p-2"
              >
                <span className="h-14 w-10 shrink-0 overflow-hidden rounded-sm border bg-muted">
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
                  className="text-destructive hover:text-destructive"
                  onClick={() => onPurge(entry)}
                >
                  {t("library.trashPurge")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {entries.length > 0 && (
            <Button type="button" variant="destructive" onClick={onPurgeAll}>
              {t("library.trashPurgeAll")}
            </Button>
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
