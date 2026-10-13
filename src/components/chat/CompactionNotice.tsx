import { useState, type ReactNode } from "react";
import { ChevronRight, History, Loader2 } from "lucide-react";
import type { AgentMessage } from "@/types/agent";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MarkdownText } from "./AssistantMessage";

interface CompactionNoticeProps {
  notice: Extract<AgentMessage, { role: "notice" }>;
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="flex shrink-0 items-center gap-1">{children}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </>
  );
}

/**
 * Durable transcript marker for a context compaction. It sits where the
 * compaction entry lives on the branch, so the conversation before it stays
 * visible after the model's context was replaced by the summary; expanding it
 * shows that summary.
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
        <Divider>
          <History className="h-3 w-3" aria-hidden />
          {t("chat.compacted")}
          <ChevronRight
            className={cn("h-3 w-3 transition-transform duration-150", expanded && "rotate-90")}
            aria-hidden
          />
        </Divider>
      </button>
      {expanded && (
        <div
          data-testid="compaction-notice-summary"
          className="mt-1.5 max-h-80 overflow-auto rounded-md border bg-muted/40 px-3 py-2 text-foreground"
        >
          <MarkdownText text={notice.summary} />
        </div>
      )}
    </div>
  );
}

/**
 * Transient state of a compaction at the end of the transcript: a pending
 * divider while the summary is generated (replaced by `CompactionNotice` when
 * it lands) — saying why when a request overflowed and the answer is about to
 * restart — or a short failure line until the next prompt.
 */
export function CompactionStatus({ status }: { status: "compacting" | "recovering" | "failed" }) {
  const { t } = useT();
  return (
    <div
      data-testid="compaction-status"
      role="status"
      className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
    >
      {status !== "failed" ? (
        <Divider>
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
          {t(status === "recovering" ? "chat.compactingAfterOverflow" : "chat.compacting")}
        </Divider>
      ) : (
        <span className="w-full text-center">{t("chat.compactionFailed")}</span>
      )}
    </div>
  );
}
