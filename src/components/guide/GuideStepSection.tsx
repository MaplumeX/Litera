import { useState, type ReactNode } from "react";
import { BookOpen, Check, ChevronDown, RefreshCw } from "lucide-react";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { BranchSwitcher } from "@/components/chat/BranchSwitcher";
import { GuideStepImages } from "@/components/chat/GuideStepImages";
import { HoldHeight } from "@/components/chat/HoldHeight";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import {
  formatRevisionLabel,
  GuideStepReexplainPopover,
} from "./GuideStepReexplainPopover";
import type { GuideBlockImage } from "@/agent/book/book-content";
import type { GuideStepNode } from "@/lib/guide-document";
import type { RecordedGuideStep, StepRevisionOptions } from "@/types/agent";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface GuideStepAction {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: (step: GuideStepNode) => void;
}

interface GuideStepSectionProps {
  node: GuideStepNode;
  bookReady: boolean;
  isStreaming: boolean;
  readOnly?: boolean;
  canOpenStep: boolean;
  availableModels?: readonly string[];
  currentModel?: string | null;
  onOpenStep: (step: RecordedGuideStep) => Promise<boolean>;
  loadStepImages?: (step: RecordedGuideStep) => Promise<GuideBlockImage[]>;
  loadStepImageUrl?: (src: string) => Promise<string>;
  onRegenerateMessage: (messageIndex: number) => void;
  onReviseStep?: (targetAnchorId: string, options: StepRevisionOptions) => void;
  onSelectRevision?: (targetAnchorId: string, revisionId: string) => void;
  onUndoLatestStep?: () => void;
  onSwitchBranch: (anchorId: string, direction: -1 | 1) => void;
  registerItem?: (index: number, element: HTMLDivElement | null) => void;
  /** Declarative per-step extension actions (e.g. Save to Note). */
  extraActions?: (step: GuideStepNode) => readonly GuideStepAction[];
}

/**
 * First-class document section for one `Guided step`: clean header bar,
 * optional inline Book figures, local revision switcher, and retelling prose.
 * Mechanical `guideRequest` user bubbles are never shown; follow-up Q&As live
 * at the chapter level.
 */
export function GuideStepSection({
  node,
  bookReady,
  isStreaming,
  readOnly = false,
  canOpenStep,
  availableModels,
  currentModel,
  onOpenStep,
  loadStepImages,
  loadStepImageUrl,
  onRegenerateMessage,
  onReviseStep,
  onSelectRevision,
  onUndoLatestStep,
  onSwitchBranch,
  registerItem,
  extraActions,
}: GuideStepSectionProps) {
  const { t } = useT();
  const [locateFailed, setLocateFailed] = useState(false);
  const [revisionMenuOpen, setRevisionMenuOpen] = useState(false);

  const branchInfo = node.branchInfo;
  const branchSwitcher =
    !branchInfo || readOnly ? undefined : (
      <Tip label={t("guide.legacyBranchTip")}>
        <span className="inline-flex items-center">
          <BranchSwitcher
            current={branchInfo.activeIndex + 1}
            total={branchInfo.options.length}
            disabled={isStreaming}
            onPrev={() =>
              onSwitchBranch(branchInfo.options[branchInfo.activeIndex - 1].anchorId, -1)
            }
            onNext={() =>
              onSwitchBranch(branchInfo.options[branchInfo.activeIndex + 1].anchorId, 1)
            }
          />
        </span>
      </Tip>
    );

  const hasRevisions = node.revisions.length > 1 && Boolean(node.revisionAnchorId) && Boolean(onSelectRevision);
  const activeRevisionIdx = Math.max(
    0,
    node.revisions.findIndex((rev) => rev.id === node.activeRevisionId),
  );
  const activeRevision = node.revisions[activeRevisionIdx];
  const activeRevisionLabel = activeRevision
    ? formatRevisionLabel(activeRevision, activeRevisionIdx, t)
    : "";

  const actions = extraActions ? extraActions(node) : [];
  const canRegenerate = !isStreaming && bookReady && !readOnly;
  const canReviseInPlace = canRegenerate && Boolean(node.revisionAnchorId) && Boolean(onReviseStep);

  return (
    <article
      data-testid="guide-step-section"
      data-step-index={node.stepIndex}
      ref={(element) => registerItem?.(node.messageIndex, element as HTMLDivElement | null)}
      className="scroll-mt-4"
    >
      <header
        data-testid="guide-step"
        className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pb-1.5 text-xs text-muted-foreground"
      >
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground/85">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{node.label}</span>
        </span>
        {node.requestText && (
          <span className="truncate rounded bg-muted/70 px-1.5 py-0.5 text-2xs text-muted-foreground">
            {node.requestText}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {hasRevisions && !readOnly && (
            <Popover open={revisionMenuOpen} onOpenChange={setRevisionMenuOpen} modal={false}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isStreaming}
                  aria-label={t("guide.revisionSwitchAria")}
                  data-testid="guide-step-revision-switcher"
                  className="inline-flex h-5 max-w-44 items-center gap-1 rounded-full bg-primary/10 px-2 text-2xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="truncate">{activeRevisionLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-60 p-1">
                <div role="listbox" aria-label={t("guide.revisionSwitchAria")} className="space-y-0.5">
                  {node.revisions.map((rev, idx) => {
                    const selected = rev.id === node.activeRevisionId;
                    return (
                      <button
                        key={rev.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-testid="guide-step-revision-option"
                        onClick={() => {
                          setRevisionMenuOpen(false);
                          if (!selected && node.revisionAnchorId && onSelectRevision) {
                            onSelectRevision(node.revisionAnchorId, rev.id);
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          selected
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-foreground/90 hover:bg-foreground/5",
                        )}
                      >
                        <Check
                          className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {formatRevisionLabel(rev, idx, t)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {branchSwitcher}
          {canOpenStep && (
            <button
              type="button"
              disabled={locateFailed}
              onClick={() => {
                onOpenStep(node.step).then(
                  (found) => setLocateFailed(!found),
                  () => setLocateFailed(true),
                );
              }}
              className="shrink-0 underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60"
            >
              {locateFailed ? t("chat.process.locateFailed") : t("chat.citation.openInBook")}
            </button>
          )}
          {actions.map((action) => (
            <Tip key={action.id} label={action.label}>
              <button
                type="button"
                disabled={action.disabled}
                aria-label={action.label}
                onClick={() => action.onClick(node)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
              >
                {action.icon}
              </button>
            </Tip>
          ))}
          {canReviseInPlace ? (
            <GuideStepReexplainPopover
              step={node}
              disabled={!canRegenerate}
              availableModels={availableModels}
              currentModel={currentModel}
              onRevise={(options) => onReviseStep!(node.revisionAnchorId!, options)}
              onUndoLatestStep={node.isLatestStep ? onUndoLatestStep : undefined}
            />
          ) : canRegenerate ? (
            <Tip label={t("guide.stepRegenerate")}>
              <button
                type="button"
                aria-label={t("guide.stepRegenerate")}
                onClick={() => onRegenerateMessage(node.requestMessageIndex ?? node.messageIndex)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </Tip>
          ) : null}
        </div>
      </header>

      {bookReady && loadStepImages && loadStepImageUrl && (
        <GuideStepImages
          step={node.step}
          loadImages={loadStepImages}
          loadImageUrl={loadStepImageUrl}
        />
      )}

      {(node.explanation || node.blocks || node.streaming || node.stopReason) && (
        <HoldHeight active={node.streaming}>
          <AssistantMessage
            message={{
              role: "assistant",
              content: node.explanation,
              blocks: node.blocks,
              stopReason: node.stopReason,
              errorMessage: node.errorMessage,
            }}
            messageIndex={node.messageIndex}
            streaming={node.streaming}
            canRegenerate={false}
          />
        </HoldHeight>
      )}
    </article>
  );
}
