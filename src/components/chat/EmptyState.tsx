import { BookOpen, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/lib/i18n";

interface EmptyStateProps {
  hasSelection: boolean;
  bookReady: boolean;
  /** A Guided session: explain the mode instead of offering prompts. */
  guided?: boolean;
  onSuggestion: (text: string) => void;
}

const SELECTION_SUGGESTIONS: MessageKey[] = [
  "chat.suggest.explain",
  "chat.suggest.viewpoint",
  "chat.suggest.rephrase",
];
const BOOK_SUGGESTIONS: MessageKey[] = [
  "chat.suggest.summarize",
  "chat.suggest.about",
  "chat.suggest.outline",
];

export function EmptyState({ hasSelection, bookReady, guided = false, onSuggestion }: EmptyStateProps) {
  const { t } = useT();
  if (guided) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center">
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><BookOpen className="size-5" /></span>
        <div>
          <h3 className="text-sm font-semibold">{t("chat.guide.emptyTitle")}</h3>
          <p className="mt-1 max-w-80 text-sm text-muted-foreground">{t("chat.guide.emptySubtitle")}</p>
        </div>
      </div>
    );
  }
  const suggestionKeys = hasSelection ? SELECTION_SUGGESTIONS : bookReady ? BOOK_SUGGESTIONS : [];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center">
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="size-5" /></span>
      <div>
        <h3 className="text-sm font-semibold">{t("chat.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {bookReady ? t("chat.subtitleReady") : t("chat.subtitleNotReady")}
        </p>
      </div>
      {suggestionKeys.length > 0 && (
        <div className="flex w-full max-w-60 flex-col gap-2">
          {suggestionKeys.map((key) => (
            <Button
              key={key}
              variant="outline"
              size="sm"
              className="h-auto justify-start rounded-xl py-1.5 text-left font-normal whitespace-normal"
              onClick={() => onSuggestion(t(key))}
            >
              {t(key)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
