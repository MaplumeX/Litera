import { useEffect, useRef } from "react";
import { Pencil, Plus, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentSessionSummary } from "@/types/agent";
import { useT } from "@/lib/i18n";

interface SessionListProps {
  sessions: AgentSessionSummary[];
  activeSessionId: string | null;
  isStreaming: boolean;
  editingSessionId: string | null;
  editingTitle: string;
  layout?: "overlay" | "rail";
  onClose?: () => void;
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
  onStartRename: (id: string, title: string) => void;
  onTitleChange: (title: string) => void;
  onSaveRename: (id: string) => void;
  onCancelRename: () => void;
  onDeleteSession: (id: string) => void;
  onOpenSettings: (session: AgentSessionSummary) => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  isStreaming,
  editingSessionId,
  editingTitle,
  layout = "overlay",
  onClose,
  onNewSession,
  onSwitchSession,
  onStartRename,
  onTitleChange,
  onSaveRename,
  onCancelRename,
  onDeleteSession,
  onOpenSettings,
}: SessionListProps) {
  const { t } = useT();
  const isRail = layout === "rail";
  // Marks Enter/Esc as already committed so the following blur does not save again.
  const renameCommittedRef = useRef(false);
  // The input unmounts on Enter/Esc commit (React does not fire blur on unmount),
  // so the flag can never be consumed there. Reset it whenever edit state changes
  // to keep the next edit's blur-save working.
  useEffect(() => {
    renameCommittedRef.current = false;
  }, [editingSessionId]);
  return (
    <div
      className={
        isRail
          ? "flex h-full min-h-0 w-[240px] shrink-0 flex-col bg-card"
          : "absolute inset-x-0 top-[37px] bottom-0 z-10 flex flex-col bg-card"
      }
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">{t("chat.sessions")}</span>
        {!isRail && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onClose}
            aria-label={t("chat.close")}
          >
            <X />
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full justify-start"
          onClick={onNewSession}
          disabled={isStreaming}
        >
          <Plus />
          {t("chat.newSession")}
        </Button>
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("chat.noSessions")}
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
              <input
                className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={editingTitle}
                onChange={(event) => onTitleChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    renameCommittedRef.current = true;
                    onSaveRename(session.id);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    renameCommittedRef.current = true;
                    onCancelRename();
                  }
                }}
                onBlur={() => {
                  if (renameCommittedRef.current) {
                    renameCommittedRef.current = false;
                    return;
                  }
                  onSaveRename(session.id);
                }}
                autoFocus
              />
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
                  aria-label={t("chat.rename")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  className="px-1 text-muted-foreground opacity-0 hover:text-primary disabled:opacity-30 group-hover:opacity-100"
                  onClick={() => onOpenSettings(session)}
                  disabled={isStreaming}
                  aria-label={t("chat.sessionSettings")}
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
                <button
                  className="px-1 text-xs text-destructive opacity-0 hover:underline disabled:opacity-30 group-hover:opacity-100"
                  onClick={() => onDeleteSession(session.id)}
                  disabled={isStreaming}
                >
                  {t("common.delete")}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
