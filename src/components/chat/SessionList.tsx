import { useEffect, useRef, useState } from "react";
import { BookOpen, MoreHorizontal, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AgentSessionSummary } from "@/types/agent";
import { useT } from "@/lib/i18n";
import {
  SESSION_TIME_GROUPS,
  formatSessionTime,
  sessionTimeGroup,
  type SessionTimeGroup,
} from "@/lib/session-time";
import { guidePositionLabel } from "./GuideBar";

interface SessionListProps {
  sessions: AgentSessionSummary[];
  activeSessionId: string | null;
  isStreaming: boolean;
  editingSessionId: string | null;
  editingTitle: string;
  layout?: "popover" | "rail";
  onNewSession: () => void;
  onNewGuided: () => void;
  onSwitchSession: (id: string) => void;
  onStartRename: (id: string, title: string) => void;
  onTitleChange: (title: string) => void;
  onSaveRename: (id: string) => void;
  onCancelRename: () => void;
  onDeleteSession: (id: string) => void;
  onOpenSettings: (session: AgentSessionSummary) => void;
}

/** Buckets sessions under time headings, keeping their order within each. */
function groupSessions(sessions: AgentSessionSummary[]) {
  const now = new Date();
  const buckets = new Map<SessionTimeGroup, AgentSessionSummary[]>();
  for (const session of sessions) {
    const group = sessionTimeGroup(session.updatedAt, now);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(session);
    else buckets.set(group, [session]);
  }
  return SESSION_TIME_GROUPS.flatMap((group) => {
    const items = buckets.get(group);
    return items ? [{ group, items }] : [];
  });
}

export function SessionList({
  sessions,
  activeSessionId,
  isStreaming,
  editingSessionId,
  editingTitle,
  layout = "popover",
  onNewSession,
  onNewGuided,
  onSwitchSession,
  onStartRename,
  onTitleChange,
  onSaveRename,
  onCancelRename,
  onDeleteSession,
  onOpenSettings,
}: SessionListProps) {
  const { t, locale } = useT();
  const isRail = layout === "rail";
  const [pendingDelete, setPendingDelete] = useState<AgentSessionSummary | null>(null);
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
          ? // On the window's ground; the conversation beside it is the card.
            "flex h-full min-h-0 w-full flex-col"
          : "flex max-h-[min(60vh,28rem)] min-h-0 flex-col"
      }
    >
      {/* The rail sits under the window titlebar, which already holds its
          toggle, so it leads with the new-session action alone; the popover
          names itself and keeps that action in its title row. */}
      {isRail ? (
        <div className="flex flex-col gap-px p-2 pb-1">
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start rounded-lg font-normal text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/5"
            onClick={onNewSession}
            disabled={isStreaming}
          >
            <Plus />
            {t("chat.newSession")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start rounded-lg font-normal text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/5"
            onClick={onNewGuided}
            disabled={isStreaming}
          >
            <BookOpen />
            {t("chat.newGuided")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b py-1.5 pr-1.5 pl-3">
          <span className="text-xs font-medium text-muted-foreground">{t("chat.sessions")}</span>
          <div className="flex items-center">
            <Tip label={t("chat.newGuided")}>
              <Button
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={onNewGuided}
                disabled={isStreaming}
                aria-label={t("chat.newGuided")}
              >
                <BookOpen />
              </Button>
            </Tip>
            <Tip label={t("chat.newSession")}>
              <Button
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={onNewSession}
                disabled={isStreaming}
                aria-label={t("chat.newSession")}
              >
                <Plus />
              </Button>
            </Tip>
          </div>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-1.5", isRail && "pt-0")}>
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("chat.noSessions")}
          </p>
        )}
        {groupSessions(sessions).map(({ group, items }) => (
          <section key={group} className="mt-2 first:mt-0">
            <h3 className="px-2 pt-1 pb-0.5 text-2xs font-medium text-muted-foreground/80">
              {t(`chat.sessionGroup.${group}`)}
            </h3>
            {items.map((session) => {
              const active = activeSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group relative flex items-center rounded-lg text-sm transition-colors duration-150 motion-reduce:transition-none",
                    active ? "bg-primary/10" : "hover:bg-foreground/5",
                  )}
                >
                  {editingSessionId === session.id ? (
                    <input
                      className="mx-1 my-0.5 min-w-0 flex-1 rounded-lg border bg-background px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                      value={editingTitle}
                      onChange={(event) => onTitleChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          renameCommittedRef.current = true;
                          onSaveRename(session.id);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          // Keep Esc from also dismissing the popover.
                          event.stopPropagation();
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
                      {/* The time cell hides on hover for the actions button, so
                          the full timestamp rides along under the title. */}
                      <Tip
                        label={`${session.title}\n${new Date(session.updatedAt).toLocaleString(locale)}`}
                        side="right"
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-2 pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          onClick={() => onSwitchSession(session.id)}
                          disabled={isStreaming}
                          aria-current={active ? "true" : undefined}
                        >
                          {session.kind === "guided" && (
                            <BookOpen
                              className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                              aria-label={t("chat.guide.badge")}
                            />
                          )}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className={cn("truncate", active && "font-medium")}>
                              {session.title}
                            </span>
                            {session.guide && (
                              <span className="truncate text-2xs text-muted-foreground">
                                {guidePositionLabel(session.guide)}
                              </span>
                            )}
                          </span>
                          {/* The time gives way to the actions button on hover,
                              keyboard focus, or while the menu is open. */}
                          <span
                            className="min-w-6 shrink-0 text-right text-2xs tabular-nums text-muted-foreground group-hover:invisible group-has-[:focus-visible]:invisible group-has-[[data-state=open]]:invisible"
                          >
                            {formatSessionTime(session.updatedAt, locale)}
                          </span>
                        </button>
                      </Tip>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 disabled:pointer-events-none data-[state=open]:opacity-100"
                            disabled={isStreaming}
                            aria-label={t("chat.sessionActions")}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="min-w-36"
                          // Rename autofocuses its input; returning focus to the
                          // trigger would blur and commit it at once.
                          onCloseAutoFocus={(event) => event.preventDefault()}
                        >
                          <DropdownMenuItem onSelect={() => onStartRename(session.id, session.title)}>
                            <Pencil />
                            {t("chat.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onOpenSettings(session)}>
                            <Settings />
                            {t("chat.sessionSettings")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setPendingDelete(session)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("chat.deleteSessionTitle", { title: pendingDelete?.title ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("chat.deleteSessionDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDeleteSession(pendingDelete.id);
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
