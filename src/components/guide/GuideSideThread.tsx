import { useEffect, useState } from "react";
import { ChevronRight, MessageSquare } from "lucide-react";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { BranchSwitcher } from "@/components/chat/BranchSwitcher";
import { HoldHeight } from "@/components/chat/HoldHeight";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import type { GuideSideQaNode } from "@/lib/guide-document";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface GuideSideThreadProps {
  threads: readonly GuideSideQaNode[];
  /** Auto-expand for the latest chapter or while a question inside it is streaming/edited. */
  defaultExpanded: boolean;
  /** External force-expand token (e.g. jumping to a side question from GuideNavRail). */
  expandedQuestionIndex?: number | null;
  isStreaming: boolean;
  bookReady: boolean;
  readOnly?: boolean;
  editingQaId: string | null;
  editDraft: string;
  onDraftChange: (value: string) => void;
  onStartEdit: (qa: GuideSideQaNode) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRegenerate: (qa: GuideSideQaNode) => void;
  onSwitchBranch: (qa: GuideSideQaNode, anchorId: string, direction: -1 | 1) => void;
  registerItem?: (index: number, element: HTMLDivElement | null) => void;
}

/**
 * Chapter-scoped follow-up Q&As rendered below the chapter's guided steps.
 * Keeps the continuous retelling clean while preserving full edit, regenerate,
 * and branch-switching capabilities on every side question.
 */
export function GuideSideThread({
  threads,
  defaultExpanded,
  expandedQuestionIndex,
  isStreaming,
  bookReady,
  readOnly = false,
  editingQaId,
  editDraft,
  onDraftChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRegenerate,
  onSwitchBranch,
  registerItem,
}: GuideSideThreadProps) {
  const { t } = useT();
  const hasActiveInteraction = threads.some(
    (qa) =>
      qa.streaming ||
      qa.id === editingQaId ||
      qa.userMessageIndex === expandedQuestionIndex,
  );
  const [expanded, setExpanded] = useState(defaultExpanded || hasActiveInteraction);

  useEffect(() => {
    if (defaultExpanded || hasActiveInteraction) setExpanded(true);
  }, [defaultExpanded, hasActiveInteraction]);

  if (threads.length === 0) return null;

  return (
    <div
      data-testid="guide-side-thread"
      className="mt-3 rounded-xl border border-border/70 bg-muted/25 px-3 py-2"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? t("guide.sideQuestionsCollapse") : t("guide.sideQuestionsExpand")}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
        <span>{t("guide.sideQuestionsCount", { count: threads.length })}</span>
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-3 border-t border-border/60 pt-2.5">
          {threads.map((qa) => {
            const branchInfo = qa.branchInfo;
            const branchSwitcher =
              !branchInfo || readOnly ? undefined : (
                <BranchSwitcher
                  current={branchInfo.activeIndex + 1}
                  total={branchInfo.options.length}
                  disabled={isStreaming}
                  onPrev={() =>
                    onSwitchBranch(qa, branchInfo.options[branchInfo.activeIndex - 1].anchorId, -1)
                  }
                  onNext={() =>
                    onSwitchBranch(qa, branchInfo.options[branchInfo.activeIndex + 1].anchorId, 1)
                  }
                />
              );

            const assistantBranchInfo = qa.assistantBranchInfo;
            const assistantBranchSwitcher =
              !assistantBranchInfo || readOnly ? undefined : (
                <BranchSwitcher
                  current={assistantBranchInfo.activeIndex + 1}
                  total={assistantBranchInfo.options.length}
                  disabled={isStreaming}
                  onPrev={() =>
                    onSwitchBranch(
                      qa,
                      assistantBranchInfo.options[assistantBranchInfo.activeIndex - 1].anchorId,
                      -1,
                    )
                  }
                  onNext={() =>
                    onSwitchBranch(
                      qa,
                      assistantBranchInfo.options[assistantBranchInfo.activeIndex + 1].anchorId,
                      1,
                    )
                  }
                />
              );

            return (
              <div
                key={qa.id}
                ref={(el) => registerItem?.(qa.userMessageIndex, el)}
                data-user-message-index={qa.userMessageIndex}
                className="scroll-mt-3 space-y-2"
              >
                <MessageBubble
                  message={{
                    role: "user",
                    content: qa.question,
                    selection: qa.selection,
                    chapterHref: qa.chapterHref,
                  }}
                  editing={editingQaId === qa.id}
                  draft={editingQaId === qa.id ? editDraft : qa.question}
                  onDraftChange={onDraftChange}
                  onStartEdit={() => onStartEdit(qa)}
                  onSave={onSaveEdit}
                  onCancel={onCancelEdit}
                  editDisabled={isStreaming || readOnly}
                  branchSwitcher={branchSwitcher}
                />
                {qa.assistantMessageIndex !== undefined ? (
                  <HoldHeight active={qa.streaming}>
                    <AssistantMessage
                      message={{
                        role: "assistant",
                        content: qa.answer,
                        blocks: qa.blocks,
                        stopReason: qa.stopReason,
                        errorMessage: qa.errorMessage,
                      }}
                      messageIndex={qa.assistantMessageIndex}
                      streaming={qa.streaming}
                      canRegenerate={!isStreaming && bookReady && !readOnly}
                      onRegenerate={() => onRegenerate(qa)}
                      branchSwitcher={assistantBranchSwitcher}
                    />
                  </HoldHeight>
                ) : qa.streaming ? (
                  <TypingIndicator />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
