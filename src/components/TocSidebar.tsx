import { useEffect, useRef } from "react";
import type { TocItem } from "@/components/ReaderView";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface TocSidebarProps {
  toc: TocItem[];
  currentHref?: string;
  onGoTo: (href: string) => void;
}

function TocNode({
  item,
  depth,
  currentHref,
  onGoTo,
}: {
  item: TocItem;
  depth: number;
  currentHref?: string;
  onGoTo: (href: string) => void;
}) {
  const isCurrent = Boolean(currentHref) && item.href === currentHref;
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isCurrent) return;
    rowRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [isCurrent]);

  return (
    <>
      <button
        ref={rowRef}
        onClick={() => onGoTo(item.href)}
        className={cn(
          "block w-full truncate rounded px-2 py-1.5 text-left text-sm",
          isCurrent
            ? "bg-accent font-medium text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        title={item.label}
      >
        {item.label}
      </button>
      {item.subitems?.map((sub, i) => (
        <TocNode
          key={i}
          item={sub}
          depth={depth + 1}
          currentHref={currentHref}
          onGoTo={onGoTo}
        />
      ))}
    </>
  );
}

export function TocSidebar({ toc, currentHref, onGoTo }: TocSidebarProps) {
  const { t } = useT();
  return (
    <nav className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center border-b px-3 text-sm font-medium">
        {t("toc.title")}
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {toc.length === 0 ? (
          <div className="px-4 py-2 text-xs text-muted-foreground">{t("toc.empty")}</div>
        ) : (
          toc.map((item, i) => (
            <TocNode
              key={i}
              item={item}
              depth={0}
              currentHref={currentHref}
              onGoTo={onGoTo}
            />
          ))
        )}
      </div>
    </nav>
  );
}