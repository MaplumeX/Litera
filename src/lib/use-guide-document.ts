import { useEffect, useMemo, useState } from "react";
import { embeddedAgentRuntime, type CanonicalGuideSnapshot } from "@/agent/runtime/embedded-runtime";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import type { TocItem } from "@/components/ReaderView";
import { projectGuideDocument, type GuideDocument } from "@/lib/guide-document";
import type { GuidePageMarks } from "@/lib/guide-marks";
import type { GuideStepCardData } from "@/lib/guide-step-cards";
import { flattenToc } from "@/lib/toc-items";
import { takenGuideSteps, type AgentEvent, type RecordedGuideStep } from "@/types/agent";

export interface UseGuideDocumentResult {
  document: GuideDocument | null;
  steps: RecordedGuideStep[];
  cards: GuideStepCardData[];
  tocProgress: Record<string, GuideChapterProgress> | undefined;
  pageMarks: GuidePageMarks | null;
  canonicalSessionId: string | null;
  hasGuide: boolean;
  loading: boolean;
}

const REFRESH_EVENTS = new Set<AgentEvent["type"]>([
  "book_ready",
  "prompt_end",
  "prompt_aborted",
  "branch_switched",
  "guide_window_updated",
  "guide_recap_added",
  "session_created",
  "session_archived",
  "session_deleted",
]);

/**
 * Book-scoped canonical Guide state: reads the open Book's canonical Guided
 * session independently of whichever Session is active in ordinary chat,
 * projecting `GuideDocument`, `PageGuideCard` data, TOC progress, and
 * Book-pane marks from a single source of truth.
 */
export function useGuideDocument(bookId: string, toc: TocItem[]): UseGuideDocumentResult {
  const flatToc = useMemo(() => flattenToc(toc), [toc]);
  const hrefs = useMemo(() => flatToc.map((item) => item.href).filter(Boolean), [flatToc]);
  const [snapshot, setSnapshot] = useState<CanonicalGuideSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [tocProgress, setTocProgress] = useState<Record<string, GuideChapterProgress> | undefined>(undefined);
  const [pageMarks, setPageMarks] = useState<GuidePageMarks | null>(null);

  useEffect(() => {
    if (!bookId) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    let disposed = false;
    let requestSeq = 0;

    const refresh = () => {
      const seq = ++requestSeq;
      if (typeof embeddedAgentRuntime.loadCanonicalGuide !== "function") return;
      setLoading(true);
      void embeddedAgentRuntime
        .loadCanonicalGuide(bookId)
        .then((next) => {
          if (disposed || seq !== requestSeq) return;
          if (next) setSnapshot(next);
          setLoading(false);
        })
        .catch((error) => {
          if (disposed || seq !== requestSeq) return;
          console.error("load canonical guide error:", error);
          setLoading(false);
        });
    };

    refresh();

    const unsubscribe =
      typeof embeddedAgentRuntime.subscribe === "function"
        ? embeddedAgentRuntime.subscribe((event) => {
            if ("bookId" in event && event.bookId && event.bookId !== bookId) return;
            if (event.type === "book_closed") {
              setSnapshot(null);
              return;
            }
            if (REFRESH_EVENTS.has(event.type)) {
              refresh();
            }
          })
        : () => {};

    const onSynced = () => refresh();
    window.addEventListener("litera:sessions-synced", onSynced);

    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("litera:sessions-synced", onSynced);
    };
  }, [bookId]);

  const steps = useMemo<RecordedGuideStep[]>(
    () => (snapshot ? takenGuideSteps(snapshot.messages) : []),
    [snapshot],
  );

  useEffect(() => {
    if (!bookId || !steps.length) {
      setTocProgress(undefined);
      setPageMarks(null);
      return;
    }
    if (
      typeof embeddedAgentRuntime.guideTocProgress !== "function" ||
      typeof embeddedAgentRuntime.guidePageMarks !== "function"
    ) {
      return;
    }
    let cancelled = false;
    Promise.all([
      embeddedAgentRuntime.guideTocProgress(steps, hrefs),
      embeddedAgentRuntime.guidePageMarks(steps),
    ])
      .then(([nextProgress, nextMarks]) => {
        if (cancelled) return;
        setTocProgress(nextProgress);
        setPageMarks(nextMarks);
      })
      .catch((error) => console.error("guide marks error:", error));
    return () => {
      cancelled = true;
    };
  }, [bookId, steps, hrefs]);

  const document = useMemo<GuideDocument | null>(() => {
    if (!snapshot) return null;
    return projectGuideDocument({
      bookId: snapshot.bookId,
      sessionId: snapshot.sessionId,
      messages: snapshot.messages,
      branchAnchors: snapshot.anchors,
      branchNavigation: snapshot.navigation,
      sideThreads: snapshot.sideThreads,
      toc: flatToc.map((item) => ({ label: item.label, href: item.href })),
      tocProgress,
    });
  }, [snapshot, flatToc, tocProgress]);

  const cards = useMemo<GuideStepCardData[]>(() => {
    if (!document) return [];
    const runSideByLastStep = new Map<number, GuideStepCardData["sideQuestions"]>();
    for (const run of document.runs) {
      const lastStep = run.steps[run.steps.length - 1];
      if (!lastStep) continue;
      const offSpine = run.sideThreads.filter((qa) => qa.sideThreadKey !== undefined && qa.answer.length > 0);
      if (offSpine.length > 0) {
        runSideByLastStep.set(
          lastStep.stepIndex,
          offSpine.map((qa) => ({ question: qa.question, answer: qa.answer })),
        );
      }
    }
    return document.steps.map((step) => ({
      stepIndex: step.stepIndex,
      step: step.step,
      label: step.label,
      messageIndex: step.messageIndex,
      explanation: step.explanation,
      sideQuestions: [
        ...step.sideThreads
          .filter((qa) => qa.answer.length > 0)
          .map((qa) => ({ question: qa.question, answer: qa.answer })),
        ...(runSideByLastStep.get(step.stepIndex) ?? []),
      ],
    }));
  }, [document]);

  return {
    document,
    steps,
    cards,
    tocProgress,
    pageMarks,
    canonicalSessionId: snapshot?.sessionId ?? null,
    hasGuide: snapshot?.sessionId != null,
    loading,
  };
}
