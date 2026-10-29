import { useEffect, useMemo, useState } from "react";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import type { TocItem } from "@/components/ReaderView";
import type { GuidePageMarks } from "@/lib/guide-marks";
import { flattenToc } from "@/lib/toc-items";
import type { RecordedGuideStep } from "@/types/agent";

/**
 * What the Book shows of a Guided session: progress per TOC href and the
 * marks in the text. Empty outside a Guided session or before its first step.
 */
export function useGuideBookMarks(steps: RecordedGuideStep[] | null, toc: TocItem[]) {
  const hrefs = useMemo(() => flattenToc(toc).map((item) => item.href).filter(Boolean), [toc]);
  const [progress, setProgress] = useState<Record<string, GuideChapterProgress> | undefined>(undefined);
  const [marks, setMarks] = useState<GuidePageMarks | null>(null);
  useEffect(() => {
    if (!steps?.length) {
      setProgress(undefined);
      setMarks(null);
      return;
    }
    let cancelled = false;
    Promise.all([embeddedAgentRuntime.guideTocProgress(steps, hrefs), embeddedAgentRuntime.guidePageMarks(steps)])
      .then(([nextProgress, nextMarks]) => {
        if (cancelled) return;
        setProgress(nextProgress);
        setMarks(nextMarks);
      })
      .catch((error) => console.error("guide marks error:", error));
    return () => { cancelled = true; };
  }, [steps, hrefs]);
  return { progress, marks };
}
