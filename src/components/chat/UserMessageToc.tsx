import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface UserMessageTocItem {
  messageIndex: number;
  preview: string;
}

interface UserMessageTocProps {
  items: UserMessageTocItem[];
  activeMessageIndex: number | null;
  onGoTo: (messageIndex: number) => void;
  onClose: () => void;
}

export function userMessagePreview(content: string, maxLength = 60): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function UserMessageToc({
  items,
  activeMessageIndex,
  onGoTo,
  onClose,
}: UserMessageTocProps) {
  const { t } = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const row = activeRowRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) return;
    list.scrollTop +=
      (rowRect.top + rowRect.bottom - listRect.top - listRect.bottom) / 2;
  }, [activeMessageIndex]);

  return (
    <div className="absolute inset-0 z-20 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-background/70"
        onClick={onClose}
        aria-label={t("chat.messageTocClose")}
      />
      <aside
        className="relative flex h-full w-[min(20rem,100%)] flex-col border-l bg-card"
        aria-label={t("chat.messageToc")}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
          <h3 className="text-sm font-medium">{t("chat.messageToc")}</h3>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label={t("chat.messageTocClose")}
          >
            <X />
          </Button>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto py-2">
          {items.map((item, position) => {
            const isActive = item.messageIndex === activeMessageIndex;
            return (
              <button
                key={item.messageIndex}
                ref={isActive ? activeRowRef : undefined}
                type="button"
                onClick={() => onGoTo(item.messageIndex)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                  isActive
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
                aria-current={isActive ? "location" : undefined}
                aria-label={t("chat.messageTocItem", {
                  number: position + 1,
                  preview: item.preview,
                })}
                title={item.preview}
              >
                <span className="w-5 shrink-0 text-right text-xs tabular-nums opacity-60">
                  {position + 1}
                </span>
                <span className="line-clamp-2 min-w-0">{item.preview}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
