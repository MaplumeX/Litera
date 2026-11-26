import type { ReactNode, RefObject } from "react";
import { ChatInput, type PendingSelection } from "@/components/chat/ChatInput";
import { GuideBar } from "@/components/chat/GuideBar";
import { useT } from "@/lib/i18n";
import type { GuideContextStats, GuideStep } from "@/types/agent";

interface GuideControlDockProps {
  nextStep: GuideStep | null | undefined;
  started: boolean;
  bookReady: boolean;
  isStreaming: boolean;
  readOnly?: boolean;
  onContinue: () => void;
  onSkip: () => void;
  onPick: () => void;
  contextStats?: GuideContextStats | null;
  onResetContext?: () => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  pendingSelection: PendingSelection | null;
  onClearSelection: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  thinkingLevel: string;
  onThinkingLevelChange: (level: string) => void;
  leadingControls?: ReactNode;
  /** Optional pace/style selector rendered beside the progression bar. */
  progressionExtras?: ReactNode;
}

/**
 * Bottom dock for `GuideWorkspace`: reading progression (`GuideBar`) takes
 * visual priority while the ask-about-section composer sits compactly below it.
 */
export function GuideControlDock({
  nextStep,
  started,
  bookReady,
  isStreaming,
  readOnly = false,
  onContinue,
  onSkip,
  onPick,
  contextStats,
  onResetContext,
  input,
  onInputChange,
  onSend,
  onAbort,
  pendingSelection,
  onClearSelection,
  textareaRef,
  thinkingLevel,
  onThinkingLevelChange,
  leadingControls,
  progressionExtras,
}: GuideControlDockProps) {
  const { t } = useT();
  if (readOnly) return null;

  return (
    <div data-testid="guide-control-dock" className="border-t border-border/60 bg-background/80 pt-1">
      {bookReady && (
        <div className="flex flex-wrap items-center justify-center gap-1 px-2">
          <GuideBar
            nextStep={nextStep}
            started={started}
            disabled={isStreaming}
            onContinue={onContinue}
            onSkip={onSkip}
            onPick={onPick}
            contextStats={contextStats}
            onResetContext={onResetContext}
          />
          {progressionExtras}
        </div>
      )}
      <ChatInput
        value={input}
        onChange={onInputChange}
        onSend={onSend}
        onAbort={onAbort}
        isStreaming={isStreaming}
        bookReady={bookReady}
        pendingSelection={pendingSelection}
        onClearSelection={onClearSelection}
        textareaRef={textareaRef}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={onThinkingLevelChange}
        leadingControls={leadingControls}
        placeholder={t("guide.askPlaceholder")}
      />
    </div>
  );
}
