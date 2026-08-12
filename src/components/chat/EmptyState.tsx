import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  hasSelection: boolean;
  bookReady: boolean;
  onSuggestion: (text: string) => void;
}

const SELECTION_SUGGESTIONS = ["解释这段文字", "这段表达了什么观点", "用更简单的话复述"];
const BOOK_SUGGESTIONS = ["总结本章内容", "这本书主要讲了什么", "帮我梳理本节要点"];

export function EmptyState({ hasSelection, bookReady, onSuggestion }: EmptyStateProps) {
  const suggestions = hasSelection ? SELECTION_SUGGESTIONS : bookReady ? BOOK_SUGGESTIONS : [];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted" aria-hidden="true">
        <Bot className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-sm font-semibold">阅读助手</h3>
        <p className="mt-1 text-sm text-muted-foreground">打开一本书，选中段落或直接提问。</p>
      </div>
      {suggestions.length > 0 && (
        <div className="flex w-full max-w-60 flex-col gap-2">
          {suggestions.map((text) => (
            <Button
              key={text}
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={() => onSuggestion(text)}
            >
              {text}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
