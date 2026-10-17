import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrashEntryList } from "@/components/TrashDialog";
import type { LibraryShelf } from "@/lib/use-library-shelf";
import { useT } from "@/lib/i18n";

/** "Recently deleted" as a page of its own, reached from the Library drawer. */
export function MobileTrashPage({ shelf, onBack }: { shelf: LibraryShelf; onBack: () => void }) {
  const { t } = useT();
  const { trashEntries } = shelf;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-1 px-1 pt-[var(--android-inset-top,0px)]">
        <Button size="icon" variant="ghost" onClick={onBack} aria-label={t("settings.back")}>
          <ChevronLeft />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-medium">{t("library.trashTitle")}</h1>
        {trashEntries.length > 0 && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void shelf.handlePurgeAll()}>
            {t("library.trashPurgeAll")}
          </Button>
        )}
      </header>
      <p className="shrink-0 px-4 pb-3 text-sm text-muted-foreground">{t("library.trashDescription")}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--android-inset-bottom,0px)+1rem)]">
        <TrashEntryList
          entries={trashEntries}
          onRestore={(entry) => void shelf.handleRestoreEntry(entry)}
          onPurge={(entry) => void shelf.handlePurgeEntry(entry)}
          className="max-h-none overflow-visible"
        />
      </div>
    </div>
  );
}
