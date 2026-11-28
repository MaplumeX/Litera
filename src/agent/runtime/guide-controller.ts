import {
  embeddedAgentRuntime,
  type CanonicalGuideSnapshot,
  type LiteraAgentRuntime,
} from "@/agent/runtime/embedded-runtime";
import type { GuideChapterProgress, GuideOutline } from "@/agent/runtime/guide";
import type { GuideBlockImage, QuoteLocation } from "@/agent/book/book-content";
import type { GuideBlockTarget, GuidePageMarks } from "@/lib/guide-marks";
import type {
  AgentEvent,
  GuideContextStats,
  GuideRequest,
  GuideSelection,
  GuideStep,
  GuideStepOptions,
  RecordedGuideStep,
  StepRevisionOptions,
} from "@/types/agent";

export type GuideRuntimePort = Pick<
  LiteraAgentRuntime,
  | "subscribe"
  | "syncBook"
  | "listSessions"
  | "loadCanonicalGuide"
  | "loadGuideSession"
  | "ensureCanonicalGuideSession"
  | "newSession"
  | "switchSession"
  | "switchBranchAtAnchor"
  | "switchSideThreadBranchAtAnchor"
  | "selectStepRevision"
  | "undoLatestGuidedStep"
  | "dismissIncompleteTailStep"
  | "rollbackToChapterRun"
  | "deleteSession"
  | "renameSession"
  | "updateSessionConfig"
  | "restartGuidedSession"
  | "restoreGuidedSession"
  | "guideContextStats"
  | "resetGuideContext"
  | "nextGuideStep"
  | "guideStepAfterChapter"
  | "guideStepAtHref"
  | "guideOutline"
  | "guideStepTo"
  | "guideStepToSelection"
  | "guideStepAnchor"
  | "guideStepImages"
  | "readStepImageUrl"
  | "guideTocProgress"
  | "guidePageMarks"
  | "locateQuote"
  | "prompt"
  | "promptSideThread"
  | "reviseGuidedStep"
  | "regenerate"
  | "regenerateSideThread"
  | "abort"
  | "refreshAfterSync"
>;

/**
 * Dedicated controller owning all Guided reading workflows (canonical Guided
 * session lifecycle, stepping with structured `GuideStepOptions`, range picks,
 * sliding context management, and Book-scoped projection inputs), decoupled
 * from ordinary multi-session Q&A UI.
 */
export class GuideController {
  private readonly runtime: GuideRuntimePort;

  constructor(runtime: GuideRuntimePort = embeddedAgentRuntime) {
    this.runtime = runtime;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.runtime.subscribe(listener);
  }

  syncBook(bookId: string): void {
    this.runtime.syncBook(bookId);
  }

  loadCanonicalGuide(bookId: string): Promise<CanonicalGuideSnapshot | null> {
    return this.runtime.loadCanonicalGuide(bookId);
  }

  loadGuideSession(bookId: string, sessionId: string): Promise<CanonicalGuideSnapshot | null> {
    return this.runtime.loadGuideSession(bookId, sessionId);
  }

  ensureCanonicalGuide(requestId?: string): Promise<string | null> {
    return this.runtime.ensureCanonicalGuideSession(requestId);
  }

  listSessions(requestId?: string) {
    return this.runtime.listSessions(requestId);
  }

  switchSession(sessionId: string, requestId?: string): Promise<void> {
    return this.runtime.switchSession(sessionId, requestId);
  }

  newGuidedSession(requestId?: string): Promise<void> {
    return this.runtime.newSession(requestId, "guided");
  }

  restartGuide(sessionId: string, requestId?: string): Promise<void> {
    return this.runtime.restartGuidedSession(sessionId, requestId);
  }

  restoreGuide(sessionId: string, requestId?: string): Promise<void> {
    return this.runtime.restoreGuidedSession(sessionId, requestId);
  }

  renameSession(sessionId: string, title: string, requestId?: string): Promise<void> {
    return this.runtime.renameSession(sessionId, title, requestId);
  }

  deleteSession(sessionId: string, requestId?: string): Promise<void> {
    return this.runtime.deleteSession(sessionId, requestId);
  }

  updateConfig(sessionId: string, systemPrompt: string, requestId?: string): Promise<void> {
    return this.runtime.updateSessionConfig(sessionId, systemPrompt, requestId);
  }

  switchBranchAtAnchor(
    sessionId: string,
    anchorId: string,
    direction: -1 | 1,
    requestId?: string,
  ): Promise<void> {
    return this.runtime.switchBranchAtAnchor(sessionId, anchorId, direction, requestId);
  }

  switchSideBranchAtAnchor(
    sessionId: string,
    sideThreadKey: string,
    anchorEntryId: string,
    direction: -1 | 1,
    requestId?: string,
  ): Promise<void> {
    return this.runtime.switchSideThreadBranchAtAnchor(
      sessionId,
      sideThreadKey,
      anchorEntryId,
      direction,
      requestId,
    );
  }

  contextStats(): GuideContextStats | null {
    return this.runtime.guideContextStats();
  }

  resetContext(): Promise<void> {
    return this.runtime.resetGuideContext();
  }

  nextStep(startHref?: string): Promise<GuideStep | null> {
    return this.runtime.nextGuideStep(startHref);
  }

  stepAfterChapter(step: GuideStep): Promise<GuideStep | null> {
    return this.runtime.guideStepAfterChapter(step);
  }

  stepAtHref(href: string): Promise<GuideStep | null> {
    return this.runtime.guideStepAtHref(href);
  }

  outline(step: GuideStep, after?: number): Promise<GuideOutline> {
    return this.runtime.guideOutline(step, after);
  }

  stepTo(
    step: GuideStep,
    to: { chapterIndex: number; block: number },
  ): Promise<GuideStep | null> {
    return this.runtime.guideStepTo(step, to);
  }

  stepToSelection(
    step: GuideStep,
    selection: GuideSelection,
  ): Promise<{ step: GuideStep } | { error: "before" | "notFound" }> {
    return this.runtime.guideStepToSelection(step, selection);
  }

  stepAnchor(
    step: RecordedGuideStep,
  ): Promise<{ chapterIndex: number; href?: string; snippet: string; target: GuideBlockTarget } | null> {
    return this.runtime.guideStepAnchor(step);
  }

  stepImages(step: RecordedGuideStep): Promise<GuideBlockImage[]> {
    return this.runtime.guideStepImages(step);
  }

  readStepImageUrl(src: string): Promise<string> {
    return this.runtime.readStepImageUrl(src);
  }

  tocProgress(
    steps: readonly RecordedGuideStep[],
    hrefs: readonly string[],
  ): Promise<Record<string, GuideChapterProgress>> {
    return this.runtime.guideTocProgress(steps, hrefs);
  }

  pageMarks(steps: readonly RecordedGuideStep[]): Promise<GuidePageMarks> {
    return this.runtime.guidePageMarks(steps);
  }

  locateQuote(chapterIndex: number, quote: string): Promise<QuoteLocation> {
    return this.runtime.locateQuote(chapterIndex, quote);
  }

  /**
   * Take a Guided step (Continue or explicit picked step) with structured
   * `GuideStepOptions` (e.g. `pace`, `styleOverride`).
   */
  takeStep(
    label: string,
    request: GuideRequest,
    options?: GuideStepOptions,
    promptId?: string,
    requestId?: string,
    editIndex?: number,
  ): Promise<void> {
    const merged: GuideRequest = {
      ...request,
      ...(options?.pace && options.pace !== "standard" ? { pace: options.pace } : {}),
      ...(options?.styleOverride?.trim() ? { styleOverride: options.styleOverride.trim() } : {}),
    };
    return this.runtime.prompt(label, { guideRequest: merged }, promptId, requestId, editIndex);
  }

  /**
   * Ask or edit a follow-up question on a chapter-scoped side-thread without
   * moving the guided spine's `leafId` or `Guide cursor`.
   */
  askSideQuestion(
    text: string,
    context: { selection?: string; chapterHref?: string; sideThreadAnchorId?: string | null },
    promptId?: string,
    requestId?: string,
    editIndex?: number,
  ): Promise<void> {
    const { sideThreadAnchorId, ...rest } = context;
    return this.runtime.promptSideThread(
      sideThreadAnchorId,
      text,
      rest,
      promptId,
      requestId,
      editIndex,
    );
  }

  /** Edit a legacy inline side-question persisted on the spine (pre-side-thread sessions). */
  editLegacySpineTurn(
    text: string,
    context: { selection?: string; chapterHref?: string },
    promptId?: string,
    requestId?: string,
    editIndex?: number,
  ): Promise<void> {
    return this.runtime.prompt(text, context, promptId, requestId, editIndex);
  }

  /** Retry / regenerate the assistant reply for an existing visible user turn without duplicating the user entry. */
  regenerateTurn(
    userMessageIndex: number,
    promptId?: string,
    requestId?: string,
  ): Promise<void> {
    return this.runtime.regenerate(userMessageIndex, promptId, requestId);
  }

  /** Retry / regenerate an assistant reply strictly inside a chapter side-thread. */
  regenerateSideTurn(
    anchorId: string | null | undefined,
    userMessageIndex: number,
    promptId?: string,
    requestId?: string,
  ): Promise<void> {
    return this.runtime.regenerateSideThread(anchorId, userMessageIndex, promptId, requestId);
  }

  /** Re-explain a committed Guided step in place (off-spine) with a pinned span and intent options. */
  reviseStep(
    targetAnchorId: string,
    options?: StepRevisionOptions,
    promptId?: string,
    requestId?: string,
    revisionId?: string,
  ): Promise<void> {
    return this.runtime.reviseGuidedStep(targetAnchorId, options, promptId, requestId, revisionId);
  }

  /** Switch the displayed revision (or `"__original__"`) for a single Guided step without moving the spine. */
  selectStepRevision(
    sessionId: string,
    targetAnchorId: string,
    revisionId: string,
    requestId?: string,
  ): Promise<void> {
    return this.runtime.selectStepRevision(sessionId, targetAnchorId, revisionId, requestId);
  }

  /** Undo strictly the latest committed Guided step on the spine so the reader can re-pick its range. */
  undoLatestStep(sessionId: string, requestId?: string): Promise<void> {
    return this.runtime.undoLatestGuidedStep(sessionId, requestId);
  }

  /** Dismiss an uncommitted (failed/aborted) tail attempt off the active spine. */
  dismissIncompleteTail(sessionId: string, requestId?: string): Promise<void> {
    return this.runtime.dismissIncompleteTailStep(sessionId, requestId);
  }

  /** Explicitly roll back the guided spine to right before the target chapter run. */
  rollbackToChapterRun(
    sessionId: string,
    runAnchorEntryId: string,
    requestId?: string,
  ): Promise<void> {
    return this.runtime.rollbackToChapterRun(sessionId, runAnchorEntryId, requestId);
  }

  abort(requestId?: string): void {
    this.runtime.abort(requestId);
  }

  refreshAfterSync(listRequestId?: string): Promise<void> {
    return this.runtime.refreshAfterSync(listRequestId);
  }
}

export const guideController = new GuideController();
