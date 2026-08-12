import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentSessionSummary } from "@/types/agent";

interface SessionListProps {
  sessions: AgentSessionSummary[];
  activeSessionId: string | null;
  isStreaming: boolean;
  editingSessionId: string | null;
  editingTitle: string;
  onClose: () => void;
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
  onStartRename: (id: string, title: string) => void;
  onTitleChange: (title: string) => void;
  onSaveRename: (id: string) => void;
  onCancelRename: () => void;
  onDeleteSession: (id: string) => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  isStreaming,
  editingSessionId,
  editingTitle,
  onClose,
  onNewSession,
  onSwitchSession,
  onStartRename,
  onTitleChange,
  onSaveRename,
  onCancelRename,
  onDeleteSession,
}: SessionListProps) {
  return (
    <div className="absolute inset-x-0 top-[37px] bottom-0 z-10 flex flex-col bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">会话列表</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full justify-start"
          onClick={onNewSession}
          disabled={isStreaming}
        >
          + 新建会话
        </Button>
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无会话，可直接提问或新建会话。
          </p>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "group flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-muted/70",
              activeSessionId === session.id && "bg-muted",
            )}
          >
            {editingSessionId === session.id ? (
              <>
                <input
                  className="flex-1 rounded border bg-background px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={editingTitle}
                  onChange={(event) => onTitleChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onSaveRename(session.id);
                    } else if (event.key === "Escape") {
                      onCancelRename();
                    }
                  }}
                  autoFocus
                />
                <button
                  className="px-1 text-xs text-primary hover:underline"
                  onClick={() => onSaveRename(session.id)}
                >
                  保存
                </button>
                <button
                  className="px-1 text-xs text-muted-foreground hover:underline"
                  onClick={onCancelRename}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <button
                  className="flex-1 truncate text-left disabled:opacity-50"
                  onClick={() => onSwitchSession(session.id)}
                  title={session.title}
                  disabled={isStreaming}
                >
                  <div className="truncate font-medium">{session.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(session.updatedAt).toLocaleString()}
                  </div>
                </button>
                <button
                  className="px-1 text-muted-foreground opacity-0 hover:text-primary disabled:opacity-30 group-hover:opacity-100"
                  onClick={() => onStartRename(session.id, session.title)}
                  disabled={isStreaming}
                  aria-label="重命名"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  className="px-1 text-xs text-destructive opacity-0 hover:underline disabled:opacity-30 group-hover:opacity-100"
                  onClick={() => onDeleteSession(session.id)}
                  disabled={isStreaming}
                >
                  删除
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
