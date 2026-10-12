import { isValidElement, memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Bot, RefreshCw } from "lucide-react";
import type { AssistantBlock, AssistantChatMessage } from "@/types/agent";
import { ToolCallCard } from "./ToolCallCard";
import { AnswerProcess } from "./AnswerProcess";
import { Citation, CitationSettledContext } from "./Citation";
import { CopyButton } from "./CopyButton";
import { TypingIndicator } from "./TypingIndicator";
import { useT } from "@/lib/i18n";
import { summarizeSources } from "@/lib/source-summary";
import { layoutAnswer, liveActivity } from "@/lib/answer-process";
import { citationChapterIndex, isCitationHref, stripCitations } from "@/lib/citations";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

const markdownComponents: Components = {
  a: ({ href, children }) =>
    isCitationHref(href) ? (
      <Citation chapterIndex={citationChapterIndex(href)} quote={nodeText(children)}>
        {children}
      </Citation>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

// Keep `cite:` links for Citations; everything else gets the default sanitizing.
const urlTransform = (url: string) => (isCitationHref(url) ? url : defaultUrlTransform(url));

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

/**
 * LaTeX 定界符预处理：
 * 1. `\[...\]` / `\(...\)` → remark-math 认识的 `$$...$$` / `$...$`；
 * 2. 单行 `$$...$$` → 独立成段的 flow 形式（remark-math 要求 `$$` 后换行
 *    才解析为块级 math，单行形式会被当作行内公式）。
 * 只处理围栏代码块与行内代码之外的内容；奇数下标是 split 捕获组命中的
 * 代码片段，原样保留。
 */
export function normalizeLatexDelimiters(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment
            .replace(/\\\[([\s\S]*?)\\\]/g, "\n\n$$$$\n$1\n$$$$\n\n")
            .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$")
            .replace(/\$\$([^\n$]+)\$\$/g, "\n\n$$$$\n$1\n$$$$\n\n"),
    )
    .join("");
}

/** The expensive part (remark/rehype + KaTeX) isolated so it only re-runs
 * when the text itself changes — never when sibling props (like the
 * regenerate button attachment) flip. */
const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
      urlTransform={urlTransform}
    >
      {text}
    </ReactMarkdown>
  );
});

const TextBlock = memo(function TextBlock({
  text,
  streaming,
  onRegenerate,
}: {
  text: string;
  streaming: boolean;
  onRegenerate?: () => void;
}) {
  const { t } = useT();
  // Memoized: every keystroke in the chat input re-renders the whole panel,
  // and re-running this regex pipeline plus the markdown/KaTeX parse per
  // keystroke is what froze long sessions.
  const normalized = useMemo(() => normalizeLatexDelimiters(text), [text]);
  return (
    <div>
      <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert">
        <CitationSettledContext.Provider value={!streaming}>
          <MarkdownBody text={normalized} />
        </CitationSettledContext.Provider>
        {streaming && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70 motion-reduce:animate-none" />
        )}
      </div>
      <div className="flex h-6 items-center gap-1">
        <CopyButton text={stripCitations(text)} />
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            aria-label={t("chat.regenerate")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});

function messageBlocks(message: AssistantChatMessage): AssistantBlock[] {
  if (message.blocks) return message.blocks;
  return message.content ? [{ type: "text", text: message.content }] : [];
}

interface AssistantMessageProps {
  message: AssistantChatMessage;
  streaming?: boolean;
  /** Whether the caller allows regeneration at all (e.g. not while streaming). */
  canRegenerate?: boolean;
  /** Stable callback: inline arrows would defeat memoization of the whole list. */
  onRegenerate?: () => void;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  streaming = false,
  canRegenerate = true,
  onRegenerate,
}: AssistantMessageProps) {
  const { t } = useT();
  const blocks = messageBlocks(message);
  const { process, answer } = useMemo(() => layoutAnswer(blocks), [blocks]);
  const sources = useMemo(() => summarizeSources(blocks), [blocks]);
  const activity = liveActivity(blocks, streaming);
  const lastBlock = blocks[blocks.length - 1];
  const liveThinking = activity?.kind === "thinking" && lastBlock?.type === "thinking" ? lastBlock.text : undefined;
  const lastTextIndex = answer.reduce((last, entry) => (entry.block.type === "text" ? entry.index : last), -1);
  return (
    <div className="flex gap-2">
      <BotAvatar />
      <div className="min-w-0 max-w-[90%] space-y-1">
        {streaming && blocks.length === 0 && <TypingIndicator />}
        {(process.length > 0 || activity) && (
          <AnswerProcess steps={process} sources={sources} activity={activity} liveThinking={liveThinking} />
        )}
        {answer.map(({ index, block }) =>
          block.type === "toolCall" ? (
            <ToolCallCard key={block.toolCall.toolCallId} call={block.toolCall} />
          ) : block.type === "text" ? (
            <TextBlock
              key={index}
              text={block.text}
              streaming={streaming && index === lastTextIndex}
              onRegenerate={
                canRegenerate && !streaming && index === lastTextIndex ? onRegenerate : undefined
              }
            />
          ) : null,
        )}
        {!streaming && canRegenerate && lastTextIndex === -1 && onRegenerate && (
          <div className="flex h-6 items-center gap-1">
            <button
              type="button"
              onClick={onRegenerate}
              className="text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
              aria-label={t("chat.regenerate")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {!streaming && message.stopReason === "aborted" && (
          <div className="flex h-6 items-center">
            <span className="text-[10px] text-muted-foreground/70">{t("chat.stopped")}</span>
          </div>
        )}
      </div>
    </div>
  );
});
