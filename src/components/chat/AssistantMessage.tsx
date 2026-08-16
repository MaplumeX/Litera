import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, Copy } from "lucide-react";
import type { AgentMessage } from "@/types/agent";
import type { BookCitation } from "@/lib/tool-citations";
import { ToolCallCard } from "./ToolCallCard";
import { TypingIndicator } from "./TypingIndicator";
import { useT } from "@/lib/i18n";

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

interface AssistantMessageProps {
  message: AgentMessage;
  streaming?: boolean;
  onOpenCitation?: (citation: BookCitation) => void;
}

export function AssistantMessage({
  message,
  streaming = false,
  onOpenCitation,
}: AssistantMessageProps) {
  return (
    <div className="flex gap-2">
      <BotAvatar />
      <div className="min-w-0 max-w-[90%] space-y-1">
        {streaming && <TypingIndicator />}
        {message.toolCalls?.map((call) => (
          <ToolCallCard key={call.toolCallId} call={call} onOpenCitation={onOpenCitation} />
        ))}
        {message.content && (
          <div>
            <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
              {streaming && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70 motion-reduce:animate-none" />
              )}
            </div>
            <div className="flex h-6 items-center">
              <CopyButton text={message.content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
