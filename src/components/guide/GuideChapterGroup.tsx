import { Fragment, useState } from "react";
import { Layers, MoreHorizontal, RotateCcw, Undo2 } from "lucide-react";
import { CompactionNotice } from "@/components/chat/CompactionNotice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { GuideIncompleteStepCard } from "./GuideIncompleteStepCard";
import { GuideSideThread } from "./GuideSideThread";
import { GuideStepSection, type GuideStepAction } from "./GuideStepSection";
import type { GuideBlockImage } from "@/agent/book/book-content";
import type {
  GuideChapterRun,
  GuideIncompleteStepNode,
  GuideSideQaNode,
  GuideStepNode,
  GuideTimelineMarker,
} from "@/lib/guide-document";
import type { RecordedGuideStep, StepRevisionOptions } from "@/types/agent";
import { useT } from "@/lib/i18n";

interface GuideChapterGroupProps {
  run: GuideChapterRun;
  isLatestRun: boolean;
  /** Number of subsequent chapter runs after `run` on the active spine (for rollback confirmation copy). */
  subsequentRunsCount?: number;
  markersByAfterStep: ReadonlyMap<number, GuideTimelineMarker[]>;
  incompleteStepsByAfterStep?: ReadonlyMap<number, GuideIncompleteStepNode[]>;
  activeTailIncompleteId?: string | null;
  expandedQuestionIndex?: number | null;
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
  onRetryIncompleteWithModel?: (model: string, messageIndex: number) => void;
  onDismissIncompleteTail?: () => void;
  onReviseStep?: (targetAnchorId: string, options: StepRevisionOptions) => void;
  onSelectRevision?: (targetAnchorId: string, revisionId: string) => void;
  onUndoLatestStep?: () => void;
  onRereadChapter?: (run: GuideChapterRun) => void;
  onRollbackChapter?: (run: GuideChapterRun) => void;
  onSwitchBranch: (anchorId: string, direction: -1 | 1) => void;
  editingQaId: string | null;
  editDraft: string;
  onDraftChange: (value: string) => void;
  onStartEditQa: (qa: GuideSideQaNode) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRegenerateQa: (qa: GuideSideQaNode) => void;
  onSwitchQaBranch: (qa: GuideSideQaNode, anchorId: string, direction: -1 | 1) => void;
  registerItem?: (index: number, element: HTMLDivElement | null) => void;
  registerChapter?: (chapterIndex: number, element: HTMLElement | null) => void;
  extraActions?: (step: GuideStepNode) => readonly GuideStepAction[];
}

export function GuideTimelineDivider({ marker }: { marker: GuideTimelineMarker }) {
  const { t } = useT();
  if (marker.kind === "compaction") {
    return <CompactionNotice notice={marker.notice} />;
  }
  return (
    <div
      data-testid="guide-context-cut"
      className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="flex items-center gap-1">
        <Layers className="h-3 w-3 shrink-0" aria-hidden />
        <span>{t("chat.guide.contextCutDivider")}</span>
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

/**
 * Groups consecutive `GuideStepSection`s from the same chapter under one
 * chapter heading for companion-book reading flow.
 */
export function GuideChapterGroup({
  run,
  isLatestRun,
  subsequentRunsCount = 0,
  markersByAfterStep,
  incompleteStepsByAfterStep,
  activeTailIncompleteId = null,
  expandedQuestionIndex,
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
  onRetryIncompleteWithModel,
  onDismissIncompleteTail,
  onReviseStep,
  onSelectRevision,
  onUndoLatestStep,
  onRereadChapter,
  onRollbackChapter,
  onSwitchBranch,
  editingQaId,
  editDraft,
  onDraftChange,
  onStartEditQa,
  onSaveEdit,
  onCancelEdit,
  onRegenerateQa,
  onSwitchQaBranch,
  registerItem,
  registerChapter,
  extraActions,
}: GuideChapterGroupProps) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const showChapterActions =
    !readOnly &&
    bookReady &&
    (Boolean(onRereadChapter) || (Boolean(onRollbackChapter) && Boolean(run.anchorEntryId)));

  return (
    <section
      data-testid="guide-chapter-group"
      data-chapter-index={run.chapterIndex}
      ref={(el) => {
        if (!run.isReread) registerChapter?.(run.chapterIndex, el);
      }}
      className="space-y-5 scroll-mt-3"
    >
      <div className="flex items-center gap-2 pt-1">
        <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
          {run.chapterTitle}
        </h2>
        {run.isReread && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            {t("guide.chapterReread")}
          </span>
        )}
        {showChapterActions && (
          <div className="ml-auto shrink-0">
            <Popover open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
              <Tip label={t("guide.chapterActionsLabel")}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={isStreaming}
                    aria-label={t("guide.chapterActionsLabel")}
                    data-testid="guide-chapter-actions-trigger"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
              </Tip>
              <PopoverContent align="end" sideOffset={6} className="w-60 p-1">
                {onRereadChapter && (
                  <button
                    type="button"
                    data-testid="guide-chapter-action-reread"
                    onClick={() => {
                      setMenuOpen(false);
                      onRereadChapter(run);
                    }}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
                  >
                    <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-foreground">
                        {t("guide.chapterRereadAction")}
                      </span>
                      <span className="block text-2xs text-muted-foreground">
                        {t("guide.chapterRereadHint")}
                      </span>
                    </span>
                  </button>
                )}
                {onRollbackChapter && run.anchorEntryId && (
                  <>
                    {onRereadChapter && <div className="my-1 h-px bg-border/60" />}
                    <button
                      type="button"
                      data-testid="guide-chapter-action-rollback"
                      onClick={() => {
                        setMenuOpen(false);
                        setRollbackConfirmOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{t("guide.chapterRollbackAction")}</span>
                    </button>
                  </>
                )}
              </PopoverContent>
            </Popover>

            <AlertDialog open={rollbackConfirmOpen} onOpenChange={setRollbackConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("guide.chapterRollbackConfirmTitle", { title: run.chapterTitle })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {subsequentRunsCount > 0
                      ? t("guide.chapterRollbackConfirmDesc", { count: subsequentRunsCount })
                      : t("guide.chapterRollbackConfirmSingleDesc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    data-testid="guide-chapter-rollback-confirm"
                    onClick={() => {
                      setRollbackConfirmOpen(false);
                      onRollbackChapter?.(run);
                    }}
                  >
                    {t("guide.chapterRollbackConfirmAction")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      <div className="space-y-6">
        {run.steps.map((node) => {
          const trailingMarkers = markersByAfterStep.get(node.stepIndex) ?? [];
          const trailingIncomplete = incompleteStepsByAfterStep?.get(node.stepIndex) ?? [];
          const trailingItems = [
            ...trailingMarkers.map((marker) => ({
              kind: "marker" as const,
              sortKey: marker.messageIndex,
              marker,
            })),
            ...trailingIncomplete.map((attempt) => ({
              kind: "incomplete" as const,
              sortKey: attempt.requestMessageIndex,
              attempt,
            })),
          ].sort((a, b) => a.sortKey - b.sortKey);

          return (
            <Fragment key={node.id}>
              <GuideStepSection
                node={node}
                bookReady={bookReady}
                isStreaming={isStreaming}
                readOnly={readOnly}
                canOpenStep={canOpenStep}
                availableModels={availableModels}
                currentModel={currentModel}
                onOpenStep={onOpenStep}
                loadStepImages={loadStepImages}
                loadStepImageUrl={loadStepImageUrl}
                onRegenerateMessage={onRegenerateMessage}
                onReviseStep={onReviseStep}
                onSelectRevision={onSelectRevision}
                onUndoLatestStep={onUndoLatestStep}
                onSwitchBranch={onSwitchBranch}
                registerItem={registerItem}
                extraActions={extraActions}
              />
              {trailingItems.map((item) =>
                item.kind === "marker" ? (
                  <GuideTimelineDivider key={`marker-${item.marker.messageIndex}`} marker={item.marker} />
                ) : (
                  <GuideIncompleteStepCard
                    key={item.attempt.id}
                    node={item.attempt}
                    defaultExpanded={item.attempt.id === activeTailIncompleteId}
                    isTail={item.attempt.id === activeTailIncompleteId}
                    bookReady={bookReady}
                    isStreaming={isStreaming}
                    readOnly={readOnly}
                    availableModels={availableModels}
                    currentModel={currentModel}
                    onRegenerate={onRegenerateMessage}
                    onRetryWithModel={onRetryIncompleteWithModel}
                    onDismiss={onDismissIncompleteTail}
                    registerItem={registerItem}
                  />
                ),
              )}
            </Fragment>
          );
        })}

        <GuideSideThread
          threads={run.sideThreads}
          defaultExpanded={isLatestRun}
          expandedQuestionIndex={expandedQuestionIndex}
          isStreaming={isStreaming}
          bookReady={bookReady}
          readOnly={readOnly}
          editingQaId={editingQaId}
          editDraft={editDraft}
          onDraftChange={onDraftChange}
          onStartEdit={onStartEditQa}
          onSaveEdit={onSaveEdit}
          onCancelEdit={onCancelEdit}
          onRegenerate={onRegenerateQa}
          onSwitchBranch={onSwitchQaBranch}
          registerItem={registerItem}
        />
      </div>
    </section>
  );
}
