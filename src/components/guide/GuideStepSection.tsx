import { useState, type ReactNode } from "react";
import { BookOpen, RefreshCw } from "lucide-react";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { BranchSwitcher } from "@/components/chat/BranchSwitcher";
import { GuideStepImages } from "@/components/chat/GuideStepImages";
import { HoldHeight } from "@/components/chat/HoldHeight";
import { Tip } from "@/components/ui/tooltip";
import { GuideSideThread } from "./GuideSideThread";
import type { GuideBlockImage } from "@/agent/book/book-content";
import type { GuideStepNode } from "@/lib/guide-document";
import type { RecordedGuideStep } from "@/types/agent";
import { useT } from "@/lib/i18n";

export interface GuideStepAction {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: (step: GuideStepNode) => void;
}

interface GuideStepSectionProps {
  node: GuideStepNode;
  isLatestStep: boolean;
  expandedQuestionIndex?: number | null;
  bookReady: boolean;
  isStreaming: boolean;
  readOnly?: boolean;
  canOpenStep: boolean;
  onOpenStep: (step: RecordedGuideStep) => Promise<boolean>;
  loadStepImages?: (step: RecordedGuideStep) => Promise<GuideBlockImage[]>;
  loadStepImageUrl?: (src: string) => Promise<string>;
  onRegenerateMessage: (messageIndex: number) => void;
  onSwitchBranch: (anchorId: string, direction: -1 | 1) => void;
  editingIndex: number | null;
  editDraft: string;
  onDraftChange: (value: string) => void;
  onStartEdit: (messageIndex: number) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  registerItem?: (index: number, element: HTMLDivElement | null) => void;
  /** Declarative per-step extension actions (e.g. Save to Note). */
  extraActions?: (step: GuideStepNode) => readonly GuideStepAction[];
}

/**
 * First-class document section for one `Guided step`: clean header bar,
 * optional inline Book figures, retelling prose, and anchored `GuideSideThread`.
 * Mechanical `guideRequest` user bubbles are never shown.
 */
export function GuideStepSection({
  node,
  isLatestStep,
  expandedQuestionIndex,
  bookReady,
  isStreaming,
  readOnly = false,
  canOpenStep,
  onOpenStep,
  loadStepImages,
  loadStepImageUrl,
  onRegenerateMessage,
  onSwitchBranch,
  editingIndex,
  editDraft,
  onDraftChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  registerItem,
  extraActions,
}: GuideStepSectionProps) {
  const { t } = useT();
  const [locateFailed, setLocateFailed] = useState(false);
  const branchInfo = node.branchInfo;
  const branchSwitcher =
    !branchInfo || readOnly ? undefined : (
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
    );
  const actions = extraActions ? extraActions(node) : [];
  const canRegenerate = !isStreaming && bookReady && !readOnly;

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
          {canRegenerate && (
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
          )}
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

      <GuideSideThread
        threads={node.sideThreads}
        defaultExpanded={isLatestStep}
        expandedQuestionIndex={expandedQuestionIndex}
        isStreaming={isStreaming}
        bookReady={bookReady}
        readOnly={readOnly}
        editingIndex={editingIndex}
        editDraft={editDraft}
        onDraftChange={onDraftChange}
        onStartEdit={onStartEdit}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onRegenerate={onRegenerateMessage}
        onSwitchBranch={onSwitchBranch}
        registerItem={registerItem}
      />
    </article>
  );
}
