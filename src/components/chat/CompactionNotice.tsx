import { useState } from "react";
import { ChevronRight, History } from "lucide-react";
import type { AgentMessage } from "@/types/agent";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CompactionNoticeProps {
  notice: Extract<AgentMessage, { role: "notice" }>;
}

/**
 * Durable transcript marker for a context compaction. It sits where the
 * compaction entry lives on the branch, so the conversation before it stays
 * visible after the model's context was replaced by the summary.
 */
export function CompactionNotice({ notice }: CompactionNoticeProps) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-testid="compaction-notice" className="py-1 text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t(expanded ? "chat.compactionHideSummary" : "chat.compactionShowSummary")}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 rounded transition-colors hover:text-foreground"
      >
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span className="flex shrink-0 items-center gap-1">
          <History className="h-3 w-3" aria-hidden />
          {t("chat.compacted")}
          <ChevronRight
            className={cn("h-3 w-3 transition-transform duration-150", expanded && "rotate-90")}
            aria-hidden
          />
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </button>
      {expanded && (
        <pre
          data-testid="compaction-notice-summary"
          className="mt-1.5 max-h-64 overflow-auto rounded border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
        >
          {notice.summary}
        </pre>
      )}
    </div>
  );
}
