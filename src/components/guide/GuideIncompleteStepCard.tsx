import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { HoldHeight } from "@/components/chat/HoldHeight";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GuideIncompleteStepNode } from "@/lib/guide-document";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface GuideIncompleteStepCardProps {
  node: GuideIncompleteStepNode;
  /** Auto-expand while this attempt sits at the timeline tail; collapse once superseded by newer steps. */
  defaultExpanded: boolean;
  /** True when this attempt is the active tail of the guided spine (enables dismiss & model retry). */
  isTail?: boolean;
  bookReady: boolean;
  isStreaming: boolean;
  readOnly?: boolean;
  availableModels?: readonly string[];
  currentModel?: string | null;
  onRegenerate: (messageIndex: number) => void;
  onRetryWithModel?: (model: string, messageIndex: number) => void;
  onDismiss?: () => void;
  registerItem?: (index: number, element: HTMLDivElement | null) => void;
}

/**
 * Compact tip recovery bar for an uncommitted guided-step attempt (aborted,
 * errored, pre-tool streaming, or replied without calling `guide_step`).
 * Never shows chat-style branch switchers; tail failures can be retried cleanly
 * (optionally with another model) or dismissed off the active spine.
 */
export function GuideIncompleteStepCard({
  node,
  defaultExpanded,
  isTail = false,
  bookReady,
  isStreaming,
  readOnly = false,
  availableModels = [],
  currentModel = null,
  onRegenerate,
  onRetryWithModel,
  onDismiss,
  registerItem,
}: GuideIncompleteStepCardProps) {
  const { t } = useT();
  const forceExpanded = node.streaming || node.status === "replied";
  const [expanded, setExpanded] = useState(defaultExpanded || forceExpanded);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  useEffect(() => {
    setExpanded(defaultExpanded || forceExpanded);
  }, [defaultExpanded, forceExpanded]);

  const canRetry = !isStreaming && bookReady && !readOnly && isTail;
  const otherModels = availableModels.filter((m) => m && m !== currentModel);
  const canRetryWithModel = canRetry && isTail && otherModels.length > 0 && Boolean(onRetryWithModel);
  const canDismiss = canRetry && isTail && Boolean(onDismiss);
  const hasBody = node.assistantMessageIndex !== undefined;
  const statusBadge =
    node.status === "aborted" ? (
      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
        {t("guide.stepAborted")}
      </span>
    ) : node.status === "error" ? (
      <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-2xs text-destructive">
        {t("guide.stepFailed")}
      </span>
    ) : null;

  return (
    <section
      data-testid="guide-incomplete-step"
      data-status={node.status}
      ref={(element) =>
        registerItem?.(node.assistantMessageIndex ?? node.requestMessageIndex, element as HTMLDivElement | null)
      }
      className="scroll-mt-4 rounded-xl border border-dashed border-border/80 bg-muted/15 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {!forceExpanded && hasBody ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={
              expanded ? t("guide.incompleteStepCollapse") : t("guide.incompleteStepExpand")
            }
            onClick={() => setExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
            <BookOpen
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                node.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span className="truncate font-medium text-foreground/80">{node.label}</span>
            {statusBadge}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <BookOpen
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                node.status === "error"
                  ? "text-destructive"
                  : node.streaming
                    ? "text-primary"
                    : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span className="truncate font-medium text-foreground/80">{node.label}</span>
            {statusBadge}
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {canRetry && (
            <button
              type="button"
              aria-label={t("guide.stepRetry")}
              onClick={() => onRegenerate(node.requestMessageIndex)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-foreground/85 transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              <span>{t("guide.stepRetry")}</span>
            </button>
          )}
          {canRetryWithModel && (
            <Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen} modal={false}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("guide.stepRetryWithModel")}
                  data-testid="guide-incomplete-model-retry"
                  className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <span>{t("guide.stepRetryWithModel")}</span>
                  <ChevronDown className="h-3 w-3 opacity-75" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="max-h-56 w-56 overflow-y-auto p-1">
                {otherModels.map((modelId) => (
                  <button
                    key={modelId}
                    type="button"
                    onClick={() => {
                      setModelMenuOpen(false);
                      onRetryWithModel?.(modelId, node.requestMessageIndex);
                    }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left font-mono text-2xs text-foreground transition-colors hover:bg-foreground/5"
                  >
                    <span className="truncate">{modelId}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
          {canDismiss && (
            <button
              type="button"
              aria-label={t("guide.stepDismiss")}
              data-testid="guide-incomplete-dismiss"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
              <span>{t("guide.stepDismiss")}</span>
            </button>
          )}
        </div>
      </div>

      {expanded && hasBody && (
        <div className="mt-2 border-t border-border/50 pt-2">
          <HoldHeight active={node.streaming}>
            <AssistantMessage
              message={{
                role: "assistant",
                content: node.content,
                blocks: node.blocks,
                stopReason: node.stopReason,
                errorMessage: node.errorMessage,
              }}
              messageIndex={node.assistantMessageIndex!}
              streaming={node.streaming}
              canRegenerate={false}
            />
          </HoldHeight>
        </div>
      )}
    </section>
  );
}
