export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-1.5" role="status" aria-label="正在生成回复">
      <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0s" }} />
      <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.15s" }} />
      <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.3s" }} />
    </div>
  );
}
