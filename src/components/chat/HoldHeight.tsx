import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * While `active`, the block grows but never shrinks. Parts of a streaming
 * answer come and go (live thinking is replaced by a one-line tool step), and
 * a transcript that gets shorter drags the reader's scroll position up with it.
 */
export function HoldHeight({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    let held = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height <= held) return;
      held = entry.contentRect.height;
      element.style.minHeight = `${held}px`;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.style.minHeight = "";
    };
  }, [active]);
  return <div ref={ref}>{children}</div>;
}
