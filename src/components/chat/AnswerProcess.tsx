import { memo, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Braces,
  Brain,
  ChevronRight,
  CircleX,
  Highlighter,
  ImageIcon,
  Info,
  ListEnd,
  ListTree,
  Loader2,
  MessageSquareText,
  Search,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";
import type { AgentToolCall } from "@/types/agent";
import { isPartialCoverage, toolResultText, type SourceSummary } from "@/lib/source-summary";
import {
  annotationCount,
  passageAnchor,
  plainExcerpt,
  readResult,
  readStepChapterIndex,
  searchHits,
  type LiveActivity,
  type ProcessStep,
} from "@/lib/answer-process";
import { CitationContext } from "./Citation";
import { ToolCallRaw, paramsSummary } from "./ToolCallCard";
import { guideStepLabel } from "./GuideBar";

type T = ReturnType<typeof useT>["t"];

function chapterLabel(t: T, chapterIndex: number | undefined, title?: string): string {
  if (title) return title;
  return t("chat.sources.chapterFallback", { number: chapterIndex === undefined ? "?" : chapterIndex + 1 });
}

function queriesLabel(t: T, call: AgentToolCall): string {
  const queries = (call.params as { queries?: unknown } | null | undefined)?.queries;
  if (!Array.isArray(queries)) return "";
  return queries
    .filter((query): query is string => typeof query === "string")
    .map((query) => t("chat.process.query", { query }))
    .join(t("common.listJoin"));
}

function readGroupChapter(t: T, calls: AgentToolCall[]): string {
  const done = calls.map(readResult).find((result) => result !== undefined);
  return chapterLabel(t, done?.chapterIndex ?? readStepChapterIndex(calls[0]), done?.title);
}

function activityText(t: T, activity: LiveActivity): string {
  if (activity.kind === "thinking") return t("chat.process.thinking");
  const { call } = activity;
  if (call.tool === "read_chapter") return t("chat.process.reading", { chapter: readGroupChapter(t, [call]) });
  if (call.tool === "search_in_book") return t("chat.process.searching", { queries: queriesLabel(t, call) });
  return t("chat.sources.reading");
}

/**
 * The source summary line, one line whatever the answer read: a single
 * chapter by name with its coverage, several as "the first and N more" with
 * one count of partly read ones. The full list is in the timeline and the
 * line's tooltip.
 */
function SourceSegments({ summary }: { summary: SourceSummary }) {
  const { t } = useT();
  const segments: { key: string; text: string; partial?: boolean; error?: boolean }[] = [];
  const titled = summary.chapters.map((chapter) => {
    const title = chapter.title ?? t("chat.sources.chapterFallback", { number: chapter.chapterNumber });
    return isPartialCoverage(chapter)
      ? t("chat.sources.partial", { title, read: chapter.partsRead.length, total: chapter.totalParts })
      : title;
  });
  const partialCount = summary.chapters.filter(isPartialCoverage).length;
  if (summary.chapters.length === 1) {
    segments.push({ key: "chapters", text: titled[0], partial: partialCount > 0 });
  } else if (summary.chapters.length > 1) {
    const first = summary.chapters[0];
    segments.push({
      key: "chapters",
      text: t("chat.sources.chapters", {
        title: first.title ?? t("chat.sources.chapterFallback", { number: first.chapterNumber }),
        count: summary.chapters.length,
        more: summary.chapters.length - 1,
      }),
    });
    if (partialCount > 0) {
      segments.push({ key: "partial", text: t("chat.sources.partialCount", { count: partialCount }), partial: true });
    }
  }
  if (summary.searches > 0) {
    segments.push({ key: "search", text: t("chat.sources.search", { count: summary.searches, hits: summary.hits }) });
  }
  for (const lookup of summary.lookups) {
    segments.push({ key: lookup, text: t(`chat.sources.${lookup}`) });
  }
  if (summary.failed > 0) {
    segments.push({ key: "failed", text: t("chat.sources.failed", { count: summary.failed }), error: true });
  }
  return (
    <span title={summary.chapters.length > 1 ? titled.join("\n") : undefined}>
      <span className="font-medium text-foreground">{t("chat.sources.label")}</span>
      {segments.map((segment, index) => (
        <span key={segment.key}>
          <span className="mx-1.5 text-muted-foreground/50">{index === 0 ? "" : "·"}</span>
          <span
            className={cn(
              segment.partial && "text-amber-700 dark:text-amber-500",
              segment.error && "text-destructive",
            )}
          >
            {segment.text}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Locates a short anchor of `text` in the Book, then reveals it in the Book pane. */
function OpenInBookButton({ chapterIndex, text }: { chapterIndex: number; text: string }) {
  const { t } = useT();
  const { locate, openInBook } = useContext(CitationContext);
  const [failed, setFailed] = useState(false);
  const anchor = passageAnchor(text);
  if (!locate || !openInBook || !anchor) return null;
  return (
    <button
      type="button"
      disabled={failed}
      onClick={() => {
        locate(chapterIndex, anchor).then(
          (location) => (location.status === "unverified" ? setFailed(true) : openInBook(location, anchor)),
          () => setFailed(true),
        );
      }}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
    >
      <BookOpen className="h-3 w-3" aria-hidden="true" />
      {failed ? t("chat.process.locateFailed") : t("chat.citation.openInBook")}
    </button>
  );
}

/** Thinking or narration: muted prose clamped to two lines, click to read it all. */
function ProseStep({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex items-start gap-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="min-w-0 text-left text-xs leading-relaxed text-muted-foreground/80"
      >
        <span className={cn("block whitespace-pre-wrap", !open && "line-clamp-2")}>{text.trim()}</span>
      </button>
    </li>
  );
}

/**
 * One tool step: an icon, a reader-facing line, optional details behind the
 * line, and the raw parameters/results behind a small `{}` toggle.
 */
function ToolStep({
  calls,
  icon,
  title,
  meta,
  details,
}: {
  calls: AgentToolCall[];
  icon: LucideIcon;
  title: string;
  meta?: string;
  details?: ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const running = calls.some((call) => !call.done);
  const error = !running && calls.some((call) => call.isError === true);
  const errorText = error
    ? calls.filter((call) => call.isError).map((call) => toolResultText(call.result) ?? "").filter(Boolean).join("\n")
    : "";
  const body = details ?? (errorText ? <p className="whitespace-pre-wrap text-destructive/80">{errorText}</p> : undefined);
  const Icon = running ? Loader2 : error ? CircleX : icon;
  const line = (
    <>
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          running ? "animate-spin text-muted-foreground motion-reduce:animate-none" : error ? "text-destructive" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 text-xs">
        <span className={cn(error ? "text-destructive" : "text-foreground/90", running && "animate-pulse motion-reduce:animate-none")}>
          {title}
        </span>
        {error && <span className="ml-1.5 text-destructive">{t("chat.toolError")}</span>}
        {meta && <span className="ml-1.5 text-muted-foreground/70">{meta}</span>}
      </span>
    </>
  );
  return (
    <li>
      <div className="group flex items-start gap-1.5">
        {body ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
          >
            {line}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-1.5">{line}</div>
        )}
        <button
          type="button"
          onClick={() => setRawOpen((value) => !value)}
          aria-pressed={rawOpen}
          aria-label={t("chat.process.raw")}
          title={t("chat.process.raw")}
          className={cn(
            "mt-0.5 shrink-0 text-muted-foreground/40 transition-opacity hover:text-muted-foreground focus-visible:opacity-100",
            !rawOpen && "opacity-0 group-hover:opacity-100",
          )}
        >
          <Braces className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && body && <div className="space-y-1.5 pb-1 pl-5 pt-1 text-xs">{body}</div>}
      {rawOpen && (
        <div className="space-y-1 pl-5 pt-1">
          {calls.map((call) => (
            <ToolCallRaw key={call.toolCallId} call={call} />
          ))}
        </div>
      )}
    </li>
  );
}

function ReadStep({ calls }: { calls: AgentToolCall[] }) {
  const { t } = useT();
  const results = calls.map(readResult).filter((result) => result !== undefined);
  const first = results[0];
  const totalParts = first?.totalParts ?? 0;
  const parts = [...new Set(results.map((result) => result.part))].sort((left, right) => left - right);
  let meta: string | undefined;
  if (totalParts > 1) {
    meta =
      parts.length === totalParts
        ? t("chat.process.readWhole", { total: totalParts })
        : t("chat.process.readParts", { parts: parts.map((part) => part + 1).join(t("common.listJoin")), total: totalParts });
  }
  const excerpt = first?.text ? plainExcerpt(first.text) : "";
  return (
    <ToolStep
      calls={calls}
      icon={BookOpen}
      title={t("chat.process.read", { chapter: readGroupChapter(t, calls) })}
      meta={meta}
      details={
        first && excerpt ? (
          <>
            <p className="line-clamp-6 whitespace-pre-wrap leading-relaxed text-muted-foreground">{excerpt}</p>
            <OpenInBookButton chapterIndex={first.chapterIndex} text={first.text} />
          </>
        ) : undefined
      }
    />
  );
}

function SearchStep({ call }: { call: AgentToolCall }) {
  const { t } = useT();
  const hits = searchHits(call);
  return (
    <ToolStep
      calls={[call]}
      icon={Search}
      title={t("chat.process.search", { queries: queriesLabel(t, call) })}
      meta={hits === undefined ? undefined : hits.length > 0 ? t("chat.process.hits", { count: hits.length }) : t("chat.process.noHits")}
      details={
        hits && hits.length > 0 ? (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {hits.map((hit, index) => (
              <li key={index} className="space-y-0.5">
                <div className="text-muted-foreground/70">{chapterLabel(t, hit.chapterIndex, hit.chapterTitle)}</div>
                <p className="line-clamp-3 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {plainExcerpt(hit.snippet, 240)}
                </p>
                <OpenInBookButton chapterIndex={hit.chapterIndex} text={hit.snippet} />
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}

const LOOKUP_STEPS: Record<string, { icon: LucideIcon; title: MessageKey }> = {
  get_toc: { icon: ListTree, title: "chat.process.toc" },
  list_guide_blocks: { icon: ListTree, title: "chat.process.blocks" },
  guide_step: { icon: ListEnd, title: "chat.process.guideStep" },
  get_book_metadata: { icon: Info, title: "chat.process.metadata" },
  list_annotations: { icon: Highlighter, title: "chat.process.annotations" },
  view_image: { icon: ImageIcon, title: "chat.process.image" },
};

/** The file name of a view_image call's `src`. */
function imageName(call: AgentToolCall): string | undefined {
  const src = (call.params as { src?: unknown } | null | undefined)?.src;
  if (typeof src !== "string" || !src) return undefined;
  const name = src.split("/").pop() || src;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function OtherToolStep({ call }: { call: AgentToolCall }) {
  const { t } = useT();
  const lookup = LOOKUP_STEPS[call.tool];
  if (!lookup) return <ToolStep calls={[call]} icon={Wrench} title={call.tool} meta={paramsSummary(call.params)} />;
  const count = call.tool === "list_annotations" ? annotationCount(call) : undefined;
  return (
    <ToolStep
      calls={[call]}
      icon={lookup.icon}
      title={t(lookup.title)}
      meta={call.tool === "view_image" ? imageName(call) : call.guide ? guideStepLabel(call.guide) : count === undefined ? undefined : t("chat.process.annotationCount", { count })}
    />
  );
}

function Step({ step }: { step: ProcessStep }) {
  switch (step.kind) {
    case "thinking":
      return <ProseStep icon={Brain} text={step.text} />;
    case "narration":
      return <ProseStep icon={MessageSquareText} text={step.text} />;
    case "read":
      return <ReadStep calls={step.calls} />;
    case "tool":
      return step.call.tool === "search_in_book" ? <SearchStep call={step.call} /> : <OtherToolStep call={step.call} />;
  }
}

/** The tail of the live thinking under the status line, following the stream. */
function LiveThinking({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <div
      ref={ref}
      className="chat-thinking-body max-h-16 overflow-hidden whitespace-pre-wrap pb-1 pl-5 text-xs leading-relaxed text-muted-foreground/70"
    >
      {text}
    </div>
  );
}

/**
 * How an answer came about, as one row above it: the source summary (or the
 * live activity while streaming), expanding into a timeline of thinking and
 * Book lookups in reader terms.
 */
export const AnswerProcess = memo(function AnswerProcess({
  steps,
  sources,
  activity,
  liveThinking,
}: {
  steps: ProcessStep[];
  sources: SourceSummary | null;
  activity: LiveActivity | null;
  /** The thinking being streamed right now, shown under the status line while collapsed. */
  liveThinking?: string;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const partial = sources?.chapters.some(isPartialCoverage) ?? false;
  let icon: ReactNode;
  let label: ReactNode;
  if (activity) {
    icon = <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />;
    label = <span className="animate-pulse motion-reduce:animate-none">{activityText(t, activity)}</span>;
  } else if (sources) {
    icon = partial ? (
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" role="img" aria-label={t("chat.sources.partialHint")} />
    ) : (
      <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    );
    label = <SourceSegments summary={sources} />;
  } else {
    icon = <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
    label = <span className="italic text-muted-foreground/70">{t("chat.thinking")}</span>;
  }
  return (
    <div className="-ml-1 rounded px-1 transition-colors hover:bg-muted/40" data-testid="answer-process">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-1.5 py-0.5 text-left"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        {icon}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{label}</span>
      </button>
      {!expanded && liveThinking && <LiveThinking text={liveThinking} />}
      {expanded && steps.length > 0 && (
        <ol className="mb-1 ml-[7px] space-y-1.5 border-l border-border/70 py-1 pl-3">
          {steps.map((step) => (
            <Step key={step.key} step={step} />
          ))}
        </ol>
      )}
    </div>
  );
});
