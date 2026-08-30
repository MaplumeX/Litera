import { useState } from "react";
import { Check, ChevronRight, CircleX, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import type { AgentToolCall } from "@/types/agent";
import { CopyButton } from "./CopyButton";

const RESULT_TRUNCATE_LIMIT = 2000;

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resultText(result: unknown): string {
  return typeof result === "string" ? result : stringifyValue(result);
}

interface ParamEntry {
  key: string;
  value: string;
}

function paramEntries(params: unknown): ParamEntry[] {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    return Object.entries(params as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: stringifyValue(value),
    }));
  }
  return [];
}

function paramsSummary(params: unknown): string {
  const entries = paramEntries(params);
  if (entries.length > 0) {
    return entries.map(({ key, value }) => `${key}: ${value}`).join(", ");
  }
  if (params == null) return "";
  return stringifyValue(params);
}

export function ToolCallCard({ call }: { call: AgentToolCall }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const running = !call.done;
  const error = call.done && call.isError === true;
  const summary = paramsSummary(call.params);
  const entries = paramEntries(call.params);
  const fullResult = call.result != null ? resultText(call.result) : "";
  const truncated = fullResult.length > RESULT_TRUNCATE_LIMIT;
  const shownResult = truncated ? fullResult.slice(0, RESULT_TRUNCATE_LIMIT) : fullResult;

  return (
    <div className="-ml-1 rounded px-1 transition-colors hover:bg-muted/40">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 py-0.5 text-left"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        {running && (
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {error && <CircleX className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />}
        {!running && !error && (
          <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden="true" />
        )}
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            error ? "text-destructive" : "text-foreground",
            running && "animate-pulse motion-reduce:animate-none",
          )}
        >
          {call.tool}
        </span>
        {error && <span className="shrink-0 text-xs text-destructive">{t("chat.toolError")}</span>}
        {summary && (
          <span className="truncate text-xs text-muted-foreground/70">{summary}</span>
        )}
      </button>
      {expanded && (
        <div className="space-y-1 pb-1">
          {entries.length > 0 && (
            <div className="space-y-0.5 text-xs">
              <div className="text-muted-foreground/60">{t("chat.toolParams")}</div>
              <dl className="space-y-0.5">
                {entries.map(({ key, value }) => (
                  <div key={key} className="flex gap-1.5">
                    <dt className="shrink-0 font-medium text-muted-foreground">{key}</dt>
                    <dd className="min-w-0 break-all text-muted-foreground/80">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {call.result != null && (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground/60">{t("chat.toolResult")}</span>
                <CopyButton text={fullResult} label={t("chat.copyResult")} />
              </div>
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground/80">
                {shownResult}
              </pre>
              {truncated && (
                <div className="text-xs text-muted-foreground/60">
                  {t("chat.resultTruncated", { count: fullResult.length })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
