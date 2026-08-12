import type { TocItem } from "@/components/ReaderView";

interface TocSidebarProps {
  toc: TocItem[];
  onGoTo: (href: string) => void;
}

function TocNode({
  item,
  depth,
  onGoTo,
}: {
  item: TocItem;
  depth: number;
  onGoTo: (href: string) => void;
}) {
  return (
    <>
      <button
        onClick={() => onGoTo(item.href)}
        className="block w-full truncate rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={item.label}
      >
        {item.label}
      </button>
      {item.subitems?.map((sub, i) => (
        <TocNode key={i} item={sub} depth={depth + 1} onGoTo={onGoTo} />
      ))}
    </>
  );
}

export function TocSidebar({ toc, onGoTo }: TocSidebarProps) {
  return (
    <nav className="flex h-full w-full flex-col overflow-hidden">
      <div className="border-b px-3 py-2 text-sm font-medium">目录</div>
      <div className="flex-1 overflow-y-auto py-1">
        {toc.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">无目录</div>
        ) : (
          toc.map((item, i) => (
            <TocNode key={i} item={item} depth={0} onGoTo={onGoTo} />
          ))
        )}
      </div>
    </nav>
  );
}