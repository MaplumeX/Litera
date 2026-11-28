import { Fragment } from "react";
import { Layers } from "lucide-react";
import { CompactionNotice } from "@/components/chat/CompactionNotice";
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
import type { RecordedGuideStep } from "@/types/agent";
import { useT } from "@/lib/i18n";

interface GuideChapterGroupProps {
  run: GuideChapterRun;
  isLatestRun: boolean;
  markersByAfterStep: ReadonlyMap<number, GuideTimelineMarker[]>;
  incompleteStepsByAfterStep?: ReadonlyMap<number, GuideIncompleteStepNode[]>;
  activeTailIncompleteId?: string | null;
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
  markersByAfterStep,
  incompleteStepsByAfterStep,
  activeTailIncompleteId = null,
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
                onOpenStep={onOpenStep}
                loadStepImages={loadStepImages}
                loadStepImageUrl={loadStepImageUrl}
                onRegenerateMessage={onRegenerateMessage}
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
                    bookReady={bookReady}
                    isStreaming={isStreaming}
                    readOnly={readOnly}
                    onRegenerate={onRegenerateMessage}
                    onSwitchBranch={onSwitchBranch}
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
