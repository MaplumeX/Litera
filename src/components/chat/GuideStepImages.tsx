import { useEffect, useRef, useState } from "react";
import type { GuideBlockImage } from "@/agent/book/book-content";
import { ImageViewer } from "@/components/ImageViewer";
import { useT } from "@/lib/i18n";
import type { ReaderImage } from "@/lib/reader-images";
import type { RecordedGuideStep } from "@/types/agent";

const MIN_FIGURE_SIDE_PX = 64;
const MIN_FIGURE_HEIGHT_PX = 20;

interface LoadedFigure {
  src: string;
  alt: string;
  caption?: string;
  url?: string;
  hidden?: boolean;
}

interface GuideStepImagesProps {
  step: RecordedGuideStep;
  loadImages: (step: RecordedGuideStep) => Promise<GuideBlockImage[]>;
  loadImageUrl: (src: string) => Promise<string>;
}

/**
 * Compact inline strip of original book figures covered by a guided step.
 * Derived lazily from the Book's blocks (zero JSONL bloat); tiny decorative
 * ornaments are filtered out once decoded, and clicking any figure opens the
 * full `ImageViewer`.
 */
export function GuideStepImages({ step, loadImages, loadImageUrl }: GuideStepImagesProps) {
  const { t } = useT();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const [figures, setFigures] = useState<LoadedFigure[]>([]);
  const [viewing, setViewing] = useState<ReaderImage | null>(null);
  const stepKey = JSON.stringify(step);

  useEffect(() => {
    if (inView || typeof IntersectionObserver === "undefined") return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    setFigures([]);
    void loadImages(step).then(async (items) => {
      if (cancelled || items.length === 0) return;
      setFigures(items.map((item) => ({ src: item.src, alt: item.alt, caption: item.caption })));
      await Promise.all(
        items.map(async (item) => {
          try {
            const url = await loadImageUrl(item.src);
            if (cancelled) return;
            setFigures((current) =>
              current.map((entry) => (entry.src === item.src ? { ...entry, url } : entry)),
            );
          } catch {
            if (cancelled) return;
            setFigures((current) =>
              current.map((entry) => (entry.src === item.src ? { ...entry, hidden: true } : entry)),
            );
          }
        }),
      );
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, stepKey, loadImages, loadImageUrl]);

  if (!inView) return <div ref={sentinelRef} aria-hidden className="h-0 w-0" />;

  const visible = figures.filter((figure) => !figure.hidden);
  if (visible.length === 0) return null;

  return (
    <>
      <div
        data-testid="guide-step-images"
        className="my-2 flex gap-2 overflow-x-auto pb-1"
      >
        {visible.map((figure) => {
          const label = figure.caption || figure.alt || t("chat.guide.figureFallback");
          return (
            <figure
              key={figure.src}
              className="group flex shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/30"
              style={{ maxWidth: visible.length === 1 ? "18rem" : "12rem" }}
            >
              <button
                type="button"
                disabled={!figure.url}
                onClick={() => figure.url && setViewing({ src: figure.url, alt: label })}
                className="relative flex min-h-24 items-center justify-center overflow-hidden bg-background/60 p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("chat.guide.openFigure", { label })}
              >
                {figure.url ? (
                  <img
                    src={figure.url}
                    alt={label}
                    loading="lazy"
                    className="max-h-40 w-auto max-w-full rounded object-contain transition-transform duration-150 group-hover:scale-[1.02]"
                    onLoad={(event) => {
                      const img = event.currentTarget;
                      // Filter tiny icons/separators once their intrinsic dimensions are known.
                      if (
                        img.naturalWidth > 0 && img.naturalHeight > 0 &&
                        ((img.naturalWidth < MIN_FIGURE_SIDE_PX && img.naturalHeight < MIN_FIGURE_SIDE_PX)
                          || img.naturalHeight < MIN_FIGURE_HEIGHT_PX)
                      ) {
                        setFigures((current) =>
                          current.map((entry) => (entry.src === figure.src ? { ...entry, hidden: true } : entry)),
                        );
                      }
                    }}
                  />
                ) : (
                  <span className="h-24 w-32 animate-pulse rounded bg-muted" aria-hidden />
                )}
              </button>
              {(figure.caption || figure.alt) && (
                <figcaption className="line-clamp-2 border-t px-2 py-1 text-2xs text-muted-foreground">
                  {figure.caption || figure.alt}
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
      {viewing && <ImageViewer image={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
