import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrashEntryList } from "@/components/TrashDialog";
import type { LibraryShelf } from "@/lib/use-library-shelf";
import { useT } from "@/lib/i18n";
import { AppBarIconButton, MobileAppBar } from "@/mobile/MobileAppBar";

/** "Recently deleted" as a page of its own, reached from the Library drawer. */
export function MobileTrashPage({ shelf, onBack }: { shelf: LibraryShelf; onBack: () => void }) {
  const { t } = useT();
  const { trashEntries } = shelf;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MobileAppBar
        navigation={
          <AppBarIconButton label={t("settings.back")} onClick={onBack}>
            <ArrowLeft />
          </AppBarIconButton>
        }
        title={t("library.trashTitle")}
        actions={
          trashEntries.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="mr-2 h-10 rounded-full px-3 text-destructive"
              onClick={() => void shelf.handlePurgeAll()}
            >
              {t("library.trashPurgeAll")}
            </Button>
          )
        }
      />
      <p className="shrink-0 px-4 pb-3 text-sm text-muted-foreground">{t("library.trashDescription")}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+1rem)]">
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
