import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AgentConfigForm } from "@/components/AgentConfigForm";
import { useT } from "@/lib/i18n";

interface AgentConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AgentConfigDialog({ open, onClose }: AgentConfigDialogProps) {
  const { t } = useT();
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className={cn("max-h-[85vh] overflow-y-auto", "sm:max-w-md")}
      >
        <DialogHeader>
          <DialogTitle>{t("agent.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("agent.description")}
          </DialogDescription>
        </DialogHeader>
        <AgentConfigForm active={open} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
