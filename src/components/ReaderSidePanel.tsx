import type { ReactNode } from "react";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type ReaderSidePanelTab = "toc" | "annotations";

const TABS: { value: ReaderSidePanelTab; labelKey: MessageKey }[] = [
  { value: "toc", labelKey: "toc.title" },
  { value: "annotations", labelKey: "annotations.title" },
];

interface ReaderSidePanelProps {
  tab: ReaderSidePanelTab;
  onTabChange: (tab: ReaderSidePanelTab) => void;
  /** Header actions for the active tab, right-aligned. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * The reader's one side panel: Contents and Annotations share a frame and
 * switch by tab, so both are one titlebar button away and look alike.
 */
export function ReaderSidePanel({ tab, onTabChange, actions, children }: ReaderSidePanelProps) {
  const { t } = useT();
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        <div role="tablist" className="flex items-center gap-0.5">
          {TABS.map((option) => {
            const selected = option.value === tab;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onTabChange(option.value)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
                  selected
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
