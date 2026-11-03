import { ArrowLeft } from "lucide-react";
import { ReadingStatsPage } from "@/components/stats/ReadingStatsPage";
import type { LibraryShelf } from "@/lib/use-library-shelf";
import { useT } from "@/lib/i18n";
import { AppBarIconButton, MobileAppBar } from "@/mobile/MobileAppBar";

/** Reading stats as a page of its own, reached from the Library's menu. */
export function MobileStatsPage({
  shelf,
  onOpenBook,
  openingBookId,
  onBack,
}: {
  shelf: LibraryShelf;
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId: string | null;
  onBack: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MobileAppBar
        navigation={
          <AppBarIconButton label={t("settings.back")} onClick={onBack}>
            <ArrowLeft />
          </AppBarIconButton>
        }
        title={t("stats.title")}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+1rem)]">
        <ReadingStatsPage
          books={shelf.books}
          coverRev={shelf.coverRev}
          openingBookId={openingBookId}
          onOpenBook={onOpenBook}
          showTitle={false}
        />
      </div>
    </div>
  );
}
