import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Temporary chat panel for verifying the pi agent sidecar round-trip.
 * Child 4 will replace this with the proper conversation panel UI.
 */

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Listen to agent events from Rust (sidecar stdout → Tauri events).
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    (async () => {
      unlisteners.push(
        await listen<{ delta: string }>("agent_text_delta", (event) => {
          setOutput((prev) => prev + event.payload.delta);
          setIsStreaming(true);
        }),
      );

      unlisteners.push(
        await listen<{ tool: string; params: unknown }>("agent_tool_start", (event) => {
          const { tool, params } = event.payload;
          setToolEvents((prev) => [
            ...prev,
            `🔧 ${tool}(${JSON.stringify(params)})`,
          ]);
        }),
      );

      unlisteners.push(
        await listen("agent_tool_end", () => {
          // Tool results are tracked but not displayed in detail for this temp UI
        }),
      );

      unlisteners.push(
        await listen("agent_end", () => {
          setIsStreaming(false);
        }),
      );

      unlisteners.push(
        await listen<{ message: string }>("agent_error", (event) => {
          setError(event.payload.message);
          setIsStreaming(false);
        }),
      );

      unlisteners.push(
        await listen("agent_ready", () => {
          setError(null);
        }),
      );
    })();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Auto-scroll output to bottom on new content.
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, toolEvents]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setOutput("");
    setToolEvents([]);
    setError(null);
    setIsStreaming(true);
    setInput("");
    try {
      await invoke("agent_prompt", { prompt: text });
    } catch (err) {
      setError(String(err));
      setIsStreaming(false);
    }
  }, [input, isStreaming]);

  const handleAbort = useCallback(async () => {
    try {
      await invoke("agent_abort");
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex h-full flex-col border-l bg-card">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Agent 对话（临时验证）</h2>
      </div>

      {/* Output area */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {output && (
          <div className="whitespace-pre-wrap break-words">{output}</div>
        )}
        {toolEvents.map((evt, i) => (
          <div
            key={i}
            className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
          >
            {evt}
          </div>
        ))}
        {!output && !toolEvents.length && !error && (
          <div className="text-muted-foreground text-xs">
            输入消息发送给 agent…
          </div>
        )}
        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-2 space-y-2">
        <div className="flex gap-2">
          <textarea
            className={cn(
              "flex-1 resize-none rounded border bg-background px-2 py-1 text-sm",
              "focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            rows={2}
            placeholder="输入消息…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
        </div>
        <div className="flex justify-end gap-2">
          {isStreaming && (
            <Button size="sm" variant="outline" onClick={() => void handleAbort()}>
              停止
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={!input.trim() || isStreaming}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}