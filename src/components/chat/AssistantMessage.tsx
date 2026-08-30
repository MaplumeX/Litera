import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Brain, ChevronRight } from "lucide-react";
import type { AgentMessage, AssistantBlock } from "@/types/agent";
import { ToolCallCard } from "./ToolCallCard";
import { CopyButton } from "./CopyButton";
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
    <div className="border-l-2 border-muted-foreground/20 pl-3">
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
        <Brain
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground",
            active && "animate-pulse motion-reduce:animate-none",
          )}
          aria-hidden="true"
        />
        <span className="text-xs italic text-muted-foreground/70">{t("chat.thinking")}</span>
      </button>
      {expanded && (
        <div className="max-h-60 overflow-y-auto whitespace-pre-wrap pb-1 text-xs text-muted-foreground/70">
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
