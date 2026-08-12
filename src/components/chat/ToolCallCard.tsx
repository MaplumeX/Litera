import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentToolCall } from "@/types/agent";

export function ToolCallCard({ call }: { call: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const paramsStr = call.params && typeof call.params === "object"
    ? Object.entries(call.params as Record<string, unknown>)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(", ")
    : String(call.params ?? "");
  return (
    <div className="rounded border bg-muted/50 text-xs">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-muted/70"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{call.tool}</span>
        <span className="truncate text-muted-foreground">({paramsStr})</span>
      </button>
      {expanded && call.result != null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t px-2 py-1 text-xs text-muted-foreground">
          {typeof call.result === "string" ? call.result : JSON.stringify(call.result, null, 2)}
        </pre>
      )}
    </div>
  );
}
