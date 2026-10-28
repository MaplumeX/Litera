import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAPTER_PART_CHARS } from "@/agent/book/book-content";
import type { GuideOutline } from "@/agent/runtime/guide";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GuideStep } from "@/types/agent";
import { paragraphsLabel, positionTitle } from "./GuideBar";

/** A step longer than this many characters gets a warning. */
const LONG_STEP_CHARS = 2 * CHAPTER_PART_CHARS;

type OutlineChapter = GuideOutline["chapters"][number];

interface PickedEnd {
  chapterIndex: number;
  block: number;
}

interface GuideRangePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The next step; the picked range starts where it starts. */
  step: GuideStep;
  /** The blocks from the step's start, or after chapter `after`. */
  loadOutline: (after?: number) => Promise<GuideOutline>;
  onPick: (to: PickedEnd, skim: boolean) => void;
}

/** The last block of the section a heading at `index` (of `chapter.blocks`) opens. */
function sectionEnd(chapter: OutlineChapter, index: number): number {
  const level = chapter.blocks[index].heading;
  for (let next = index + 1; next < chapter.blocks.length; next += 1) {
    const heading = chapter.blocks[next].heading;
    if (heading > 0 && heading <= level) return chapter.firstBlock + next - 1;
  }
  return chapter.firstBlock + chapter.blocks.length - 1;
}

/** Whether block `block` of chapter `chapterIndex` comes at or before `end`. */
function upTo(end: PickedEnd | null, chapterIndex: number, block: number): boolean {
  return !!end && (chapterIndex < end.chapterIndex || (chapterIndex === end.chapterIndex && block <= end.block));
}

/**
 * The "Read to…" picker of a Guided session: the blocks after the Guide
 * cursor, grouped by chapter and heading. The reader picks where the next
 * step ends, then reads or skims up to there.
 */
export function GuideRangePicker({ open, onOpenChange, step, loadOutline, onPick }: GuideRangePickerProps) {
  const { t, locale } = useT();
  const [chapters, setChapters] = useState<OutlineChapter[]>([]);
  const [more, setMore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [end, setEnd] = useState<PickedEnd | null>(null);
  const loadId = useRef(0);

  const load = useCallback(async (after?: number) => {
    const id = ++loadId.current;
    setLoading(true);
    setError(null);
    try {
      const outline = await loadOutline(after);
      if (id !== loadId.current) return;
      setChapters((current) => (after === undefined ? outline.chapters : [...current, ...outline.chapters]));
      setMore(outline.more);
    } catch (cause) {
      if (id === loadId.current) setError(String(cause));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [loadOutline]);

  useEffect(() => {
    if (!open) return;
    setChapters([]);
    setMore(null);
    setEnd(null);
    void load();
    return () => { loadId.current += 1; };
  }, [open, step, load]);

  const chars = useMemo(() => {
    let total = 0;
    for (const chapter of chapters) {
      chapter.blocks.forEach((block, index) => {
        if (upTo(end, chapter.chapterIndex, chapter.firstBlock + index)) total += block.chars;
      });
    }
    return total;
  }, [chapters, end]);

  const format = (count: number) => count.toLocaleString(locale);
  const start = chapters[0];
  const endChapter = end && chapters.find((chapter) => chapter.chapterIndex === end.chapterIndex);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 p-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("chat.guide.pick")}</DialogTitle>
          <DialogDescription>
            {start
              ? t("chat.guide.pickHint", { title: positionTitle(start), where: paragraphsLabel(start.firstBlock, start.firstBlock) })
              : t("chat.guide.pickLoading")}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {chapters.map((chapter) => (
            <section key={chapter.chapterIndex} className="mb-2">
              <button
                type="button"
                className={cn(
                  "sticky top-0 z-10 flex w-full items-baseline justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-left text-sm font-semibold hover:bg-accent",
                  end?.chapterIndex === chapter.chapterIndex && end.block === chapter.firstBlock + chapter.blocks.length - 1 && "text-primary",
                )}
                onClick={() => setEnd({ chapterIndex: chapter.chapterIndex, block: chapter.firstBlock + chapter.blocks.length - 1 })}
              >
                <span className="min-w-0 truncate">{positionTitle(chapter)}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">{t("chat.guide.pickChapter")}</span>
              </button>
              <ol>
                {chapter.blocks.map((block, index) => {
                  // Blank blocks still count toward a range, but there is nothing to pick.
                  if (block.kind === "blank") return null;
                  // The heading that opens a chapter repeats the chapter's own row.
                  if (block.heading > 0 && block.snippet === chapter.chapterTitle?.trim()) return null;
                  const number = chapter.firstBlock + index;
                  const inRange = upTo(end, chapter.chapterIndex, number);
                  const isEnd = end?.chapterIndex === chapter.chapterIndex && end.block === number;
                  return (
                    <li key={number}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
                          inRange && "bg-accent/50",
                          isEnd && "bg-primary/10 ring-1 ring-primary/40",
                          block.heading > 0 && "mt-1 font-medium",
                        )}
                        onClick={() => setEnd({
                          chapterIndex: chapter.chapterIndex,
                          block: block.heading > 0 ? sectionEnd(chapter, index) : number,
                        })}
                      >
                        <span className={cn("min-w-0 flex-1 truncate", block.heading === 0 && "text-muted-foreground")}>
                          {block.kind === "image" ? t("chat.guide.pickImage", { alt: block.snippet }) : block.snippet}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {block.heading > 0 ? t("chat.guide.pickSection") : number + 1}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
          {more !== null && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              disabled={loading}
              onClick={() => void load(more)}
            >
              {loading ? t("chat.guide.pickLoading") : t("chat.guide.pickMore")}
            </Button>
          )}
        </div>

        <div className="space-y-1 text-xs" aria-live="polite">
          <p className="text-muted-foreground">
            {end && endChapter
              ? t("chat.guide.pickSelected", {
                  title: positionTitle(endChapter),
                  where: paragraphsLabel(end.block, end.block),
                  chars: t("chat.guide.pickChars", { count: format(chars) }),
                })
              : t("chat.guide.pickNone")}
          </p>
          {end && chars > LONG_STEP_CHARS && (
            <p className="text-amber-600 dark:text-amber-400">{t("chat.guide.pickLong", { count: format(chars) })}</p>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!end} onClick={() => end && onPick(end, true)}>
            {t("chat.guide.pickSkim")}
          </Button>
          <Button size="sm" disabled={!end} onClick={() => end && onPick(end, false)}>
            {t("chat.guide.pickRead")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
