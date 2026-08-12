import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import type { AgentMessage } from "@/types/agent";
import { ToolCallCard } from "./ToolCallCard";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
      aria-label="复制"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

export function AssistantMessage({ message }: { message: AgentMessage }) {
  return (
    <div className="space-y-1">
      {message.toolCalls?.map((call) => <ToolCallCard key={call.toolCallId} call={call} />)}
      {message.content && (
        <div className="group relative">
          <CopyButton text={message.content} />
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
