import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Brain, Check, ChevronRight, Copy } from "lucide-react";
import type { AgentMessage, AssistantBlock } from "@/types/agent";
import { ToolCallCard } from "./ToolCallCard";
import { TypingIndicator } from "./TypingIndicator";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground/50 transition-colors hover:text-muted-foreground"
      aria-label={t("chat.copy")}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function BotAvatar() {
  return (
    <div
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted"
      aria-hidden="true"
    >
      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

function ThinkingBlock({ thinking, active }: { thinking: string; active: boolean }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(active);
  useEffect(() => {
    if (!active) setExpanded(false);
  }, [active]);
  return (
    <div className="rounded border bg-muted/50 text-xs">
      <button
        type="button"
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
        <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{t("chat.thinking")}</span>
      </button>
      {expanded && (
        <div className="whitespace-pre-wrap border-t px-2 py-1 text-xs text-muted-foreground">
          {thinking}
        </div>
      )}
    </div>
  );
}

function TextBlock({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div>
      <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {text}
        </ReactMarkdown>
        {streaming && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70 motion-reduce:animate-none" />
        )}
      </div>
      <div className="flex h-6 items-center">
        <CopyButton text={text} />
      </div>
    </div>
  );
}

function messageBlocks(message: AgentMessage): AssistantBlock[] {
  if (message.blocks) return message.blocks;
  return message.content ? [{ type: "text", text: message.content }] : [];
}

interface AssistantMessageProps {
  message: AgentMessage;
  streaming?: boolean;
}

export function AssistantMessage({ message, streaming = false }: AssistantMessageProps) {
  const blocks = messageBlocks(message);
  const textBlocks = blocks.filter((block): block is Extract<AssistantBlock, { type: "text" }> => block.type === "text");
  const lastTextIndex = textBlocks.length > 0
    ? blocks.lastIndexOf(textBlocks[textBlocks.length - 1])
    : -1;
  return (
    <div className="flex gap-2">
      <BotAvatar />
      <div className="min-w-0 max-w-[90%] space-y-1">
        {streaming && <TypingIndicator />}
        {blocks.map((block, index) => {
          if (block.type === "thinking") {
            return block.text ? (
              <ThinkingBlock key={index} thinking={block.text} active={streaming} />
            ) : null;
          }
          if (block.type === "toolCall") {
            return <ToolCallCard key={block.toolCall.toolCallId} call={block.toolCall} />;
          }
          return <TextBlock key={index} text={block.text} streaming={streaming && index === lastTextIndex} />;
        })}
      </div>
    </div>
  );
}
