import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { AgentSessionSummary } from "@/types/agent";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export type SessionConfigTarget = Pick<
  AgentSessionSummary,
  "id" | "title" | "systemPrompt" | "kind" | "archived"
>;

interface SessionConfigDialogProps {
  open: boolean;
  session: SessionConfigTarget | null;
  isStreaming: boolean;
  onClose: () => void;
  onSave: (systemPrompt: string) => void;
  /** Archive this canonical Guided session and start a fresh one. */
  onRestartGuided?: (sessionId: string) => void;
}

export function SessionConfigDialog({
  open,
  session,
  isStreaming,
  onClose,
  onSave,
  onRestartGuided,
}: SessionConfigDialogProps) {
  const { t } = useT();
  const [promptDraft, setPromptDraft] = useState(session?.systemPrompt ?? "");
  const [confirmRestart, setConfirmRestart] = useState(false);

  // Reseed drafts on every open so cancel-then-reopen shows the persisted values.
  useEffect(() => {
    if (open) {
      setPromptDraft(session?.systemPrompt ?? "");
      setConfirmRestart(false);
    }
  }, [open, session]);

  const handleSave = () => {
    if (isStreaming) return;
    onSave(promptDraft);
  };

  const canRestart = !!session && session.kind === "guided" && !session.archived && !!onRestartGuided;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className={cn("max-h-[85vh] overflow-y-auto", "sm:max-w-md")}>
          <DialogHeader>
            <DialogTitle>{t("chat.sessionConfigTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("chat.sessionConfigDescription")}
            </DialogDescription>
          </DialogHeader>
          {session && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("chat.systemPrompt")}
                  </Label>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setPromptDraft("")}
                    disabled={isStreaming || promptDraft === ""}
                    aria-label={t("chat.clearPrompt")}
                  >
                    {t("chat.clearPrompt")}
                  </Button>
                </div>
                <textarea
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                  rows={5}
                  disabled={isStreaming}
                />
                <p className="text-xs text-muted-foreground">{t("chat.systemPromptHint")}</p>
              </div>
              {canRestart && (
                <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{t("chat.guide.restartTitle")}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("chat.guide.restartHint")}</p>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      disabled={isStreaming}
                      onClick={() => setConfirmRestart(true)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t("chat.guide.restartAction")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={isStreaming}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isStreaming}>
              {t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.guide.restartConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.guide.restartConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRestart(false);
                if (session && onRestartGuided) onRestartGuided(session.id);
              }}
            >
              {t("chat.guide.restartAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
